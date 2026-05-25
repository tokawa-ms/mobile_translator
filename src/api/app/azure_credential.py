from azure.identity.aio import DefaultAzureCredential

_credential: DefaultAzureCredential | None = None


def get_credential() -> DefaultAzureCredential:
    global _credential
    if _credential is None:
        _credential = DefaultAzureCredential(exclude_interactive_browser_credential=True)
    return _credential


async def close_credential() -> None:
    global _credential
    if _credential is not None:
        await _credential.close()
        _credential = None
