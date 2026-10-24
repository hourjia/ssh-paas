import threading

from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import EnvTask, Server
from .serializers import EnvTaskSerializer, ServerSerializer
from .services.envcheck import run_pipeline


class ServerViewSet(viewsets.ModelViewSet):
    queryset = Server.objects.all()
    serializer_class = ServerSerializer

    @action(detail=True, methods=['post'])
    def connect(self, request, pk=None):
        """连接服务器并执行环境检查/准备，立即返回任务 id，由前端轮询结果。"""
        server = self.get_object()
        running = EnvTask.objects.filter(server=server, status=EnvTask.Status.RUNNING).first()
        if running:
            return Response({'task_id': running.id, 'reused': True}, status=status.HTTP_202_ACCEPTED)
        task = EnvTask.objects.create(server=server)
        threading.Thread(target=run_pipeline, args=(task.id,), daemon=True).start()
        return Response({'task_id': task.id}, status=status.HTTP_202_ACCEPTED)


class EnvTaskViewSet(mixins.RetrieveModelMixin, mixins.ListModelMixin, viewsets.GenericViewSet):
    queryset = EnvTask.objects.select_related('server')
    serializer_class = EnvTaskSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        server_id = self.request.query_params.get('server')
        if server_id:
            qs = qs.filter(server_id=server_id)
        return qs
