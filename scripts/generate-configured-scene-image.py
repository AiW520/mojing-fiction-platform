import importlib.util
import os
from pathlib import Path

# The user explicitly selected sunburst; reuse the Tuzi skill's single-request transport.
skill_script = Path(os.environ['SCENE_TUZI_SKILL_SCRIPT']).resolve()
spec = importlib.util.spec_from_file_location('scene_tuzi_generator', skill_script)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
selected_model = os.environ['SCENE_IMAGE_MODEL']
if selected_model != 'gpt-image-2.5-sunburst':
    raise SystemExit('Image model has not been authorized')
module.MODEL = selected_model
raise SystemExit(module.main())
