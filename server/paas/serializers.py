from rest_framework import serializers

from .models import EnvTask, Server
from .services.crypto import encrypt


class ServerSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, required=False, allow_blank=True, trim_whitespace=False)
    private_key = serializers.CharField(write_only=True, required=False, allow_blank=True, trim_whitespace=False)
    password_set = serializers.SerializerMethodField()
    key_set = serializers.SerializerMethodField()

    class Meta:
        model = Server
        fields = [
            'id', 'name', 'host', 'port', 'username', 'auth_type',
            'password', 'private_key', 'password_set', 'key_set',
            'auto_prepare', 'status', 'os_info', 'env_status',
            'last_checked_at', 'created_at',
        ]
        read_only_fields = ['status', 'os_info', 'env_status', 'last_checked_at', 'password_set', 'key_set']

    def get_password_set(self, obj) -> bool:
        return bool(obj.password_enc)

    def get_key_set(self, obj) -> bool:
        return bool(obj.private_key_enc)

    def validate(self, attrs):
        auth_type = attrs.get('auth_type', getattr(self.instance, 'auth_type', Server.AuthType.PASSWORD))
        if self.instance is None:
            password = attrs.get('password', '')
            private_key = attrs.get('private_key', '')
            if auth_type == Server.AuthType.PASSWORD and not password:
                raise serializers.ValidationError({'password': '密码登录必须提供密码'})
            if auth_type == Server.AuthType.KEY and not private_key:
                raise serializers.ValidationError({'private_key': '私钥登录必须提供私钥内容'})
        return attrs

    def create(self, validated_data):
        password = validated_data.pop('password', '')
        private_key = validated_data.pop('private_key', '')
        server = Server(**validated_data)
        if password:
            server.password_enc = encrypt(password)
        if private_key:
            server.private_key_enc = encrypt(private_key)
        server.save()
        return server

    def update(self, instance, validated_data):
        # 留空表示不修改已存凭据
        password = validated_data.pop('password', None)
        private_key = validated_data.pop('private_key', None)
        for field, value in validated_data.items():
            setattr(instance, field, value)
        if password:
            instance.password_enc = encrypt(password)
        if private_key:
            instance.private_key_enc = encrypt(private_key)
        instance.save()
        return instance


class EnvTaskSerializer(serializers.ModelSerializer):
    server_id = serializers.IntegerField(source='server.id', read_only=True)
    server_name = serializers.CharField(source='server.name', read_only=True)

    class Meta:
        model = EnvTask
        fields = ['id', 'server_id', 'server_name', 'status', 'report', 'duration_ms', 'created_at', 'finished_at']
