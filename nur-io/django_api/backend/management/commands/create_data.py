from .create_sample_data import Command as CreateSampleCommand


class Command(CreateSampleCommand):
    help = "Creates data (loads real data from public/ when available and synthesizes missing)."
