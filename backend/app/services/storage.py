from __future__ import annotations

import shutil
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

from fastapi import UploadFile

from ..config import settings


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
        from azure.storage.blob import BlobServiceClient

        if not settings.azure_storage_account_url:
            raise RuntimeError("AZURE_STORAGE_ACCOUNT_URL is required for STORAGE_BACKEND=azure")
        container = settings.azure_storage_documents_container if kind == "documents" else settings.azure_storage_receipts_container
        client = BlobServiceClient(settings.azure_storage_account_url, credential=DefaultAzureCredential())
        blob = client.get_blob_client(container=container, blob=blob_name)
        upload.file.seek(0)
        blob.upload_blob(upload.file, overwrite=True)
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

    def get_read_url(self, blob_path: str) -> str | None:
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
        )
        return f"{settings.azure_storage_account_url.rstrip('/')}/{container}/{name}?{sas}"


storage_service = StorageService()
