import os
from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache

class Settings(BaseSettings):
    # JWT
    jwt_secret: str = ""
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 1440  # 24h

    # Supabase
    supabase_url: str = "http://localhost"
    supabase_service_role_key: str = "test-key"     # privileged operations only — backend trusted authority

    # Blockchain
    alchemy_sepolia_url: str = "http://localhost"
    marketplace_address: str = "0x0000000000000000000000000000000000000000"

    # Multi-chain support
    target_chain_id: int = 11155111          # 1 = Mainnet, 11155111 = Sepolia
    mainnet_rpc_url: str = ""               # e.g. https://mainnet.infura.io/v3/KEY
    sepolia_rpc_url: str = ""               # e.g. https://sepolia.infura.io/v3/KEY
    contract_address: str = ""              # set after mainnet deploy

    @property
    def rpc_url(self) -> str:
        """Return the RPC URL for the configured target chain."""
        if self.target_chain_id == 1:
            return self.mainnet_rpc_url or self.alchemy_sepolia_url  # fallback for dev
        # Sepolia: prefer sepolia_rpc_url, fall back to legacy alchemy_sepolia_url
        return self.sepolia_rpc_url or self.alchemy_sepolia_url

    # Redis
    redis_url: str

    # Pinata
    pinata_jwt: str = ""
    ipfs_gateway_url: str = "https://gateway.pinata.cloud"

    # Admin wallets — comma-separated list of wallet addresses with admin role
    # e.g. ADMIN_WALLETS=0xabc...,0xdef...
    admin_wallets: str = ""
    allowed_origins: list[str] = [
        "http://localhost:5173",
        "http://localhost:3000",
        "https://model-chain-phi.vercel.app",
    ]

    model_config = SettingsConfigDict(env_file="/app/.env", extra="ignore")

    def validate_security(self) -> None:
        """
        FIX 5: Hard startup validation — raises immediately if any security
        config is unsafe, rather than running silently with known-bad values.
        Call this once from main.py on startup.
        """
        errors: list[str] = []

        # JWT secret must be set and not the default
        if self.jwt_secret in (
            "test-secret-key-minimum-32-characters-long-hardcoded-default",
            "change-me-in-production",
            "",
            "secret",
            "password",
        ):
            errors.append(
                "JWT_SECRET is set to the default placeholder value. "
                "Generate one with: python -c \"import secrets; print(secrets.token_hex(32))\""
            )
        if len(self.jwt_secret) < 32:
            errors.append(
                f"JWT_SECRET is too short ({len(self.jwt_secret)} chars). Minimum 32 characters required."
            )

        # In production (non-localhost origins), block http:// CORS origins
        non_local_origins = [
            o for o in self.allowed_origins
            if "localhost" not in o and "127.0.0.1" not in o
        ]
        http_origins = [o for o in non_local_origins if o.startswith("http://")]
        if http_origins:
            errors.append(
                f"Insecure HTTP origins in ALLOWED_ORIGINS: {http_origins}. "
                "Production origins must use https://."
            )

        # Ensure service role key exists
        if not self.supabase_service_role_key:
            errors.append("SUPABASE_SERVICE_ROLE_KEY is missing but required for backend authority.")
        else:
            assert self.supabase_service_role_key is not None, "Service Role Key must be configured."

        if errors:
            msg = "\n".join(f"  • {e}" for e in errors)
            raise RuntimeError(
                f"\n\n🔒 ModelChain security configuration errors:\n{msg}\n\n"
                "Fix these before starting the server."
            )


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    print("ACTIVE JWT SECRET:", settings.jwt_secret)
    print("REDIS URL:", settings.redis_url)
    return settings
