from authentication.providers.oauth2.client import OAuth2Client, OAuth2Error
import requests
from urllib.parse import parse_qsl

from django.utils.http import urlencode


class AnafOAuth2Client(OAuth2Client):
    def get_access_token(self, code):
        data = {
            "redirect_uri": self.callback_url,
            "grant_type": "authorization_code",
            "code": code,
            "token_content_type": "jwt",
        }
        auth = requests.auth.HTTPBasicAuth(
            self.consumer_key, self.consumer_secret
        )

        params = None
        self._strip_empty_keys(data)
        url = self.access_token_url
        if self.access_token_method == "GET":
            params = data
            data = None
        # TODO: Proper exception handling
        resp = requests.request(
            self.access_token_method,
            url,
            params=params,
            data=data,
            headers=self.headers,
            auth=auth,
        )

        access_token = None
        if resp.status_code in [200, 201]:
            # Weibo sends json via 'text/plain;charset=UTF-8'
            if (
                resp.headers["content-type"].split(";")[0]
                == "application/json"
                or resp.text[:2] == '{"'
            ):
                access_token = resp.json()
            else:
                access_token = dict(parse_qsl(resp.text))
        if not access_token or "access_token" not in access_token:
            raise OAuth2Error(
                "Error retrieving access token: %s" % resp.content
            )
        print(access_token, type(access_token))
        return access_token
