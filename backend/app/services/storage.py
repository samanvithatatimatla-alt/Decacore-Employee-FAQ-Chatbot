from __future__ import annotations

import mimetypes
import shutil
import threading
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

from fastapi import UploadFile

from ..config import settings


def _guess_type(name: str) -> str:
    """Content type for a stored file, defaulting to PDF.

    Everything the app stores is a policy document or a receipt, and mimetypes only
    misses when a file arrives with no extension — where PDF is the better guess than
    octet-stream, which the browser downloads rather than displays.
    """
    return mimetypes.guess_type(name)[0] or "application/pdf"


# How long a user delegation key is requested for, and how close to its expiry it may
# still be reused. The key signs the SAS, so a SAS can never outlive it.
DELEGATION_KEY_LIFETIME = timedelta(hours=1)
DELEGATION_KEY_MARGIN = timedelta(minutes=10)


class StorageService:
    def __init__(self):
        settings.local_documents_dir.mkdir(parents=True, exist_ok=True)
        settings.local_receipts_dir.mkdir(parents=True, exist_ok=True)
        self._service_instance = None
        self._delegation: tuple[object, datetime] | None = None
        self._lock = threading.Lock()

    def _service(self):
        """One BlobServiceClient per process.

        Building it per call meant constructing DefaultAzureCredential and fetching a
        managed-identity token every time someone opened a PDF, which is most of the
        pause between clicking a citation and the document appearing.
        """
        if self._service_instance is None:
            with self._lock:
                if self._service_instance is None:
                    from azure.identity import DefaultAzureCredential
                    from azure.storage.blob import BlobServiceClient

                    self._service_instance = BlobServiceClient(
                        settings.azure_storage_account_url, credential=DefaultAzureCredential()
                    )
        return self._service_instance

    def _delegation_key(self, service):
        """The signing key, reused until it is close to expiring.

        A second network round trip per document open, for a key that is valid for an
        hour and identical every time within it.
        """
        now = datetime.now(UTC)
        cached = self._delegation
        if cached is not None and now < cached[1] - DELEGATION_KEY_MARGIN:
            return cached[0], cached[1]
        with self._lock:
            cached = self._delegation
            if cached is not None and now < cached[1] - DELEGATION_KEY_MARGIN:
                return cached[0], cached[1]
            start = now - timedelta(minutes=5)
            expiry = now + DELEGATION_KEY_LIFETIME
            key = service.get_user_delegation_key(start, expiry)
            self._delegation = (key, expiry)
            return key, expiry

    def save_upload(self, upload: UploadFile, kind: str) -> str:
        safe_name = Path(upload.filename or "upload.bin").name
        blob_name = f"{uuid4()}-{safe_name}"
        if settings.storage_backend == "local":
            base = settings.local_documents_dir if kind == "documents" else settings.local_receipts_dir
            dest = base / blob_name
            upload.file.seek(0)
            with dest.open("wb") as out:
                shutil.copyfileobj(upload.file, out)
            return f"{kind}/{blob_name}"

        from azure.storage.blob import ContentSettings

        if not settings.azure_storage_account_url:
            raise RuntimeError("AZURE_STORAGE_ACCOUNT_URL is required for STORAGE_BACKEND=azure")
        container = settings.azure_storage_documents_container if kind == "documents" else settings.azure_storage_receipts_container
        blob = self._service().get_blob_client(container=container, blob=blob_name)
        upload.file.seek(0)
        # Without explicit settings Azure stores every blob as application/octet-stream,
        # which makes the browser download the file instead of rendering it — a tab
        # opened to view a policy just sits on about:blank.
        blob.upload_blob(
            upload.file,
            overwrite=True,
            content_settings=ContentSettings(
                content_type=upload.content_type or _guess_type(safe_name),
                content_disposition=f'inline; filename="{safe_name}"',
            ),
        )
        return f"{container}/{blob_name}"

    def copy_seed_document(self, source: Path, filename: str) -> str:
        dest = settings.local_documents_dir / filename
        if not dest.exists():
            shutil.copy2(source, dest)
        return f"documents/{filename}"

    def local_path(self, blob_path: str) -> Path:
        prefix, _, name = blob_path.partition("/")
        if prefix == "documents":
            return settings.local_documents_dir / name
        if prefix == "receipts":
            return settings.local_receipts_dir / name
        # Seed rows may use policies/... paths before migration.
        if prefix == "policies":
            return settings.local_documents_dir / name
        raise ValueError("Unknown local blob path")

    def read_bytes(self, blob_path: str) -> bytes:
        if settings.storage_backend == "local":
            return self.local_path(blob_path).read_bytes()
        container, _, name = blob_path.partition("/")
        return self._service().get_blob_client(container, name).download_blob().readall()

    def get_read_url(self, blob_path: str, filename: str | None = None) -> str | None:
        if settings.storage_backend == "local":
            return None
        from azure.storage.blob import BlobSasPermissions, generate_blob_sas

        container, _, name = blob_path.partition("/")
        service = self._service()
        delegation_key, key_expiry = self._delegation_key(service)
        start = datetime.now(UTC) - timedelta(minutes=5)
        # Never past the signing key's own expiry, or the link is rejected.
        expiry = min(start + timedelta(minutes=20), key_expiry)
        sas = generate_blob_sas(
            account_name=service.account_name,
            container_name=container,
            blob_name=name,
            user_delegation_key=delegation_key,
            permission=BlobSasPermissions(read=True),
            start=start,
            expiry=expiry,
            # rsct/rscd: the SAS overrides the blob's stored headers on this response.
            # Every blob written before uploads set content settings is still stored as
            # application/octet-stream, and re-uploading them all to fix that is not
            # worth it — overriding per-request repairs old and new blobs alike.
            content_type=_guess_type(filename or name),
            content_disposition=f'inline; filename="{Path(filename or name).name}"',
        )
        return f"{settings.azure_storage_account_url.rstrip('/')}/{container}/{name}?{sas}"


storage_service = StorageService()
