from rest_framework.routers import DefaultRouter

from .views import EnvTaskViewSet, ServerViewSet

router = DefaultRouter()
router.register('servers', ServerViewSet)
router.register('env-tasks', EnvTaskViewSet, basename='env-tasks')

urlpatterns = router.urls
