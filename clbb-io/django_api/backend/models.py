from django.db import models

class Indicator(models.Model):
    id = models.AutoField(primary_key=True)
    indicator_id = models.IntegerField()
    name = models.CharField(max_length=100)
    has_states = models.BooleanField(default=False)
    description = models.TextField(blank=True, null=True)
    category = models.CharField(max_length=50, choices=[
        ('mobility', 'Mobility'),
        ('climate', 'Climate'),
        ('land_use', 'Land Use')
    ], default='mobility')

    def __str__(self):
        return self.name

class State(models.Model):
    id = models.AutoField(primary_key=True)
    state_values = models.JSONField(default=dict, blank=True, null=True)  # Almacena los valores de estado en formato JSON

    def __str__(self):
        return f"State with values {self.state_values}"
    
class IndicatorData(models.Model):
    id = models.AutoField(primary_key=True)
    indicator = models.ForeignKey(Indicator, on_delete=models.CASCADE, related_name='data')
    state = models.ForeignKey(State, on_delete=models.CASCADE, related_name='data')

    def __str__(self):
        return f"Data {self.id}"

class IndicatorImage(models.Model):
    id = models.AutoField(primary_key=True)
    indicatorData = models.ForeignKey(IndicatorData, on_delete=models.CASCADE, related_name='images')
    image = models.ImageField(upload_to='indicators/')

    def __str__(self):
        return f"Image {self.id}"

class IndicatorGeojson(models.Model):
    id = models.AutoField(primary_key=True)
    indicatorData = models.ForeignKey(IndicatorData, on_delete=models.CASCADE, related_name='geojson')
    geojson = models.JSONField()

    def __str__(self):
        return f"Geojson {self.id}"
    
class DashboardFeedState(models.Model):
    id = models.AutoField(primary_key=True)
    state = models.ForeignKey(State, on_delete=models.CASCADE, related_name='dashboard_feed')
    data = models.JSONField(default=dict)
    dashboard_type = models.CharField(max_length=50, choices=[
        ('mobility', 'Mobility'),
        ('climate', 'Climate'),
        ('land_use', 'Land Use')
    ], default='mobility')

    def __str__(self):
        return f"DashboardFeedState {self.id}"
    
class LayerConfig(models.Model):
    id = models.AutoField(primary_key=True)
    indicatorData = models.ForeignKey(IndicatorData, on_delete=models.CASCADE, related_name='layer_config')
    layer_config = models.JSONField(default=dict)

    def __str__(self):
        return f"LayerConfig {self.id}"

class MapType(models.Model):
    id = models.AutoField(primary_key=True)
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True, null=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name

