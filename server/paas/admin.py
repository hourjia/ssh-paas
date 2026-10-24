from django.contrib import admin

from .models import EnvTask, Server


@admin.register(Server)
class ServerAdmin(admin.ModelAdmin):
    list_display = ('name', 'host', 'port', 'username', 'status', 'env_status', 'last_checked_at')
    search_fields = ('name', 'host')


@admin.register(EnvTask)
class EnvTaskAdmin(admin.ModelAdmin):
    list_display = ('id', 'server', 'status', 'duration_ms', 'created_at', 'finished_at')
    list_filter = ('status',)
