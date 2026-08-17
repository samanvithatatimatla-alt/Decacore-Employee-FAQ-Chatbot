from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "DecaCore Employee FAQ Backend"
    env: str = "dev"
    log_level: str = "INFO"
    auth_mode: Literal["dev", "entra"] = "dev"
    dev_user_email: str = "marietta.baudone@gmail.com"
    auto_seed: bool = True
    database_url: str = "sqlite:///./data/decacore.db"
    retention_days: int = 7
    enable_dynamic_watermark: bool = False
    cors_origins: str = "http://localhost:3000,http://localhost:5173"

    entra_tenant_id: str = "0eadb77e-42dc-47f8-bbe3-ec2395e0712c"
    entra_client_id: str = "efccb481-74ba-45b8-940a-fed5dfbec74e"
    entra_object_id: str = "2680dbf6-06a6-44b1-abd5-77f56f5b5fd1"
    entra_audience: str = "api://efccb481-74ba-45b8-940a-fed5dfbec74e"

    storage_backend: Literal["local", "azure"] = "local"
    azure_storage_account_url: str = ""
    azure_storage_documents_container: str = "documents"
    azure_storage_receipts_container: str = "receipts"

    search_backend: Literal["local", "azure"] = "local"
    azure_search_endpoint: str = ""
    azure_search_index: str = "decacore-hr-policies"
    azure_search_api_key: str = ""

    llm_backend: Literal["offline", "azure"] = "offline"
    azure_openai_endpoint: str = ""
    azure_openai_api_key: str = ""
    azure_openai_chat_deployment: str = ""
    azure_openai_embedding_deployment: str = ""
    azure_openai_embedding_dimensions: int = 1536

    notification_backend: Literal["log", "graph"] = "log"
    graph_tenant_id: str = "0eadb77e-42dc-47f8-bbe3-ec2395e0712c"
    graph_client_id: str = "efccb481-74ba-45b8-940a-fed5dfbec74e"
    graph_client_secret: str = ""
    graph_sender_user: str = ""
    hr_notification_email: str = ""

    local_search_top_k: int = 5
    local_min_score: float = 0.08

    # Relevance floor for the Azure backend. Same scale as local_min_score — both are
    # cosine similarity from local_score — but kept separate so the deployed app can be
    # tuned without touching local behaviour. Every answer logs its relevance score, so
    # pick this from real numbers in the App Service log stream rather than by feel.
    azure_min_score: float = 0.08

    @property
    def project_root(self) -> Path:
        return Path(__file__).resolve().parents[1]

    @property
    def seed_dir(self) -> Path:
        return self.project_root / "data" / "seed"

    @property
    def local_documents_dir(self) -> Path:
        return self.project_root / "data" / "storage" / "documents"

    @property
    def local_receipts_dir(self) -> Path:
        return self.project_root / "data" / "storage" / "receipts"

    @property
    def cors_origin_list(self) -> list[str]:
        return [x.strip() for x in self.cors_origins.split(",") if x.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
