from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("backend", "0033_otefviewportstate_road_signs")]
    operations = [migrations.CreateModel(
        name="OTEFStaffRemoteUpdates",
        fields=[
            ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
            ("device_id", models.UUIDField(blank=True, null=True)),
            ("revision", models.PositiveBigIntegerField(default=0)),
            ("notice_build_id", models.CharField(blank=True, max_length=25, null=True)),
            ("notice_created_at", models.DateTimeField(blank=True, null=True)),
            ("table", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name="staff_remote_updates", to="backend.table")),
        ],
    )]
