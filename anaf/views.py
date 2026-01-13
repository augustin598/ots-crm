import requests

from authentication.providers.oauth2.views import (
    OAuth2Adapter,
    OAuth2CallbackView,
    OAuth2LoginView,
)
import jwt

from .provider import CustomAnafProvider
from allauth.socialaccount.adapter import get_adapter
from allauth.socialaccount.models import (
    SocialAccount,
    SocialLogin,
    SocialToken,
)
from datetime import timedelta
from django.utils import timezone


class AnafOAuth2RestAdapter(OAuth2Adapter):
    provider_id = CustomAnafProvider.id
    access_token_url = "https://logincert.anaf.ro/anaf-oauth2/v1/token"
    authorize_url = "https://logincert.anaf.ro/anaf-oauth2/v1/authorize"
    revoke_url = "https://logincert.anaf.ro/anaf-oauth2/v1/revoke"

    def complete_login(self, request, app, social_token, **kwargs):

        access_token = bytes(social_token.token, "utf-8")
        user_data = jwt.decode(access_token, verify=False)

        adapter = get_adapter(request)
        uid = user_data.get("sub")
        socialaccount = SocialAccount(
            extra_data={}, uid=uid, provider=self.provider_id
        )
        if request.user.is_authenticated:
            socialaccount.user = request.user
            email_addresses = [request.user.email]
        else:
            socialaccount = SocialAccount.objects.filter(
                uid=uid, provider=self.provider_id
            ).first()
            if not socialaccount:
                socialaccount = SocialAccount(
                    extra_data={}, uid=uid, provider=self.provider_id
                )
                socialaccount.save()

        sociallogin = SocialLogin(
            account=socialaccount, email_addresses=email_addresses
        )
        return sociallogin

    def parse_token(self, data):
        token = SocialToken(token=data["access_token"])
        token.token_secret = data.get("refresh_token", "")
        if expires_in := data.get(self.expires_in_key, None):
            token.expires_at = timezone.now() + timedelta(
                seconds=int(expires_in)
            )
        token.save()
        return token


oauth2_login = OAuth2LoginView.adapter_view(AnafOAuth2RestAdapter)
oauth2_callback = OAuth2CallbackView.adapter_view(AnafOAuth2RestAdapter)
