import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings

_NAMESPACE = b'ourjia-paas:credentials:v1'


def _fernet() -> Fernet:
    # v1 用 SECRET_KEY 派生密钥；更换 SECRET_KEY 会导致已存凭据无法解密
    digest = hashlib.sha256(settings.SECRET_KEY.encode() + _NAMESPACE).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt(text: str) -> str:
    return _fernet().encrypt(text.encode('utf-8')).decode('ascii')


def decrypt(text: str) -> str:
    try:
        return _fernet().decrypt(text.encode('ascii')).decode('utf-8')
    except InvalidToken as exc:
        raise ValueError('凭据解密失败：SECRET_KEY 可能已变更') from exc
