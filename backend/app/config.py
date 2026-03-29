from pydantic_settings import BaseSettings
from functools import lru_cache
import secrets

class Settings(BaseSettings):
    # JWT
    jwt_secret: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 1440  # 24h

    # Supabase
    supabase_url: str
    supabase_service_role_key: str     # privileged operations only — backend trusted authority

    # Blockchain
    alchemy_sepolia_url: str
    marketplace_address: str = "0x3131f5ea556cbeBe3A09F3AB42EDb8F3C630240D"

    # Redis
    redis_url: str = "redis://localhost:6379"

    # Pinata
    pinata_jwt: str = ""

    # Admin wallets — comma-separated list of wallet addresses with admin role
    # e.g. ADMIN_WALLETS=0xabc...,0xdef...
    admin_wallets: str = ""
    allowed_origins: list[str] = ["http://localhost:5173", "https://modelchain.vercel.app"]

    class Config:
        env_file = ".env"

    def validate_security(self) -> None:
        """
        FIX 5: Hard startup validation — raises immediately if any security
        config is unsafe, rather than running silently with known-bad values.
        Call this once from main.py on startup.
        """
        errors: list[str] = []

        # JWT secret must be set and not the default
        if self.jwt_secret in ("change-me-in-production", "", "secret", "password"):
            errors.append(
                "JWT_SECRET is set to the default placeholder value. "
                f"Generate one with: python -c \"import secrets; print(secrets.token_hex(32))\""
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
    return Settings()
