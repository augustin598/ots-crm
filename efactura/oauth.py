from datetime import datetime
from authentication.providers.anaf.views import AnafOAuth2RestAdapter
import requests
from core.models import Options
import jwt


def get_spv_access_token(user_id: int):
    from allauth.socialaccount.models import SocialToken, SocialApp

    token = SocialToken.objects.filter(
        app__provider="anaf", account__user_id=user_id
    ).first()

    if not token:
        raise Exception("No token found")

    access_token = bytes(token.token, "utf-8")
    decoded_access_token = jwt.decode(access_token, verify=False)
    print(decoded_access_token)
    ##decoed['exp'] is "exp": 1714935401, the expiration date of the token

    ##exp tp be a datetime object
    expiration = datetime.utcfromtimestamp(decoded_access_token["exp"])

    if expiration < datetime.utcnow():
        options = Options.objects.first()
        app = SocialApp.objects.get(provider="anaf")
        result = requests.post(
            AnafOAuth2RestAdapter.access_token_url,
            data={
                "grant_type": "refresh_token",
                "refresh_token": token.token_secret,
                "client_id": app.client_id,
                "client_secret": app.secret,
            },
        )
        result.raise_for_status()
        data = result.json()
        token.token = data["access_token"]
        token.token_secret = data["refresh_token"]
        token.save()

    return token.token
