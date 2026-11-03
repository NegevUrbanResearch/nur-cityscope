import inspect
import unittest

from otef_layer_processing.orchestrator import ProcessingOrchestrator


class PmtilesOrchestratorContractTests(unittest.TestCase):
    def test_cache_hit_branch_regenerates_existing_pmtiles_before_advertising(self):
        source = inspect.getsource(ProcessingOrchestrator.process_single_layer)
        cache_branch = source[source.index("cached = self.cache[cache_key]") :]

        self.assertIn("generate_pmtiles=lambda", cache_branch)
        self.assertIn("regenerate_existing=True", cache_branch)


if __name__ == "__main__":
    unittest.main()
