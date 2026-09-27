"""Source records are never modified: the whole dataset is byte-identical after a full run."""
import hashlib

from interop.config import Settings
from interop.service import LandStackService
from interop.sources import JsonSourceStore

from .conftest import AS_OF


def _hash_tree(root):
    return {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(root.rglob("*")) if p.is_file()}


def test_full_pipeline_and_api_leave_sources_untouched(settings, client):
    before = _hash_tree(settings.data_root)
    svc = LandStackService(JsonSourceStore(settings.data_root), settings=Settings(as_of=AS_OF))
    svc.warm()
    for ident in svc.registry.identities():
        for path in ("", "/profile", "/ownership", "/mutation", "/gis", "/verification"):
            assert client.get(f"/v1/parcels/{ident.ulpin}{path}").status_code == 200
    client.get("/v1/analytics/data-quality")
    assert _hash_tree(settings.data_root) == before
