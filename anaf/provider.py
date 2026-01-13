from allauth.account.models import EmailAddress
from allauth.socialaccount.app_settings import QUERY_EMAIL
from allauth.socialaccount.providers.base import AuthAction, ProviderAccount
from allauth.socialaccount.providers.oauth2.provider import OAuth2Provider


class CustomAnafAccount(ProviderAccount):
    def get_profile_url(self):
        return "https://www.anaf.ro/"

    def to_str(self):
        d = super().to_str()
        return d


class CustomAnafProvider(OAuth2Provider):
    id = "anaf"
    name = "Anaf"
    account_class = CustomAnafAccount


provider_classes = [CustomAnafProvider]
