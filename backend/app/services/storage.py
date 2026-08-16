from __future__ import annotations

import mimetypes
import shutil
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


class StorageService:
    def __init__(self):
        settings.local_documents_dir.mkdir(parents=True, exist_ok=True)
        settings.local_receipts_dir.mkdir(parents=True, exist_ok=True)

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

        from azure.identity import DefaultAzureCredential
        from azure.storage.blob import BlobServiceClient, ContentSettings

        if not settings.azure_storage_account_url:
            raise RuntimeError("AZURE_STORAGE_ACCOUNT_URL is required for STORAGE_BACKEND=azure")
        container = settings.azure_storage_documents_container if kind == "documents" else settings.azure_storage_receipts_container
        client = BlobServiceClient(settings.azure_storage_account_url, credential=DefaultAzureCredential())
        blob = client.get_blob_client(container=container, blob=blob_name)
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
        from azure.identity import DefaultAzureCredential
        from azure.storage.blob import BlobServiceClient

        container, _, name = blob_path.partition("/")
        client = BlobServiceClient(settings.azure_storage_account_url, credential=DefaultAzureCredential())
        return client.get_blob_client(container, name).download_blob().readall()

    def get_read_url(self, blob_path: str, filename: str | None = None) -> str | None:
        if settings.storage_backend == "local":
            return None
        from azure.identity import DefaultAzureCredential
        from azure.storage.blob import (
            BlobSasPermissions,
            BlobServiceClient,
            generate_blob_sas,
        )

        container, _, name = blob_path.partition("/")
        service = BlobServiceClient(settings.azure_storage_account_url, credential=DefaultAzureCredential())
        start = datetime.now(UTC) - timedelta(minutes=5)
        expiry = start + timedelta(minutes=20)
        delegation_key = service.get_user_delegation_key(start, expiry)
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
