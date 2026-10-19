from django.db import migrations, models


def preserve_current_experience(apps, schema_editor):
    State = apps.get_model("backend", "OTEFViewportState")
    Layer = apps.get_model("backend", "LayerState")
    Group = apps.get_model("backend", "LayerGroup")
    for state in State.objects.all().iterator():
        narrative = state.narrative_state if isinstance(state.narrative_state, dict) else {}
        clock = state.investigation_clock if isinstance(state.investigation_clock, dict) else {}
        nli_layers = Layer.objects.filter(table_id=state.table_id, enabled=True, layer_id__startswith="nli.").exists()
        nli_layers = nli_layers or Group.objects.filter(table_id=state.table_id, enabled=True, group_id="nli").exists()
        nli_layers = nli_layers or any(str(key).startswith("nli.") and value is True for key, value in (state.layers or {}).items())
        state.active_experience = "nli" if state.exhibit_mode or narrative.get("id") or clock.get("phase") in ("playing", "paused", "ended") or nli_layers else "regular"
        state.exhibit_mode = state.active_experience == "nli"
        # Historical authored step identity cannot be recovered from layer visibility.
        # Keep the live scene; the first explicit entry without a bookmark uses Home.
        state.save(update_fields=["active_experience", "exhibit_mode"])


class Migration(migrations.Migration):
    dependencies = [("backend", "0035_merge_tablet_updates_and_projection_v8")]
    operations = [
        migrations.AddField(model_name="otefviewportstate", name="active_experience", field=models.CharField(default="regular", max_length=16)),
        migrations.AddField(model_name="otefviewportstate", name="experience_revision", field=models.PositiveBigIntegerField(default=0)),
        *[migrations.AddField(model_name="otefviewportstate", name=name, field=models.JSONField(blank=True, default=dict))
          for name in ("saved_regular_context", "saved_nli_context", "experience_pending", "experience_receipt", "nli_bookmark")],
        migrations.RunPython(preserve_current_experience, migrations.RunPython.noop),
    ]
