import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ARTIFACTS = ROOT / 'artifacts' / 'qa'
ARTIFACTS.mkdir(parents=True, exist_ok=True)


def launch_browser(playwright):
    options = {
        'headless': True,
        'args': ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    }
    configured = os.environ.get('CHROME_PATH')
    windows_chrome = Path('C:/Program Files/Google/Chrome/Application/chrome.exe')
    if configured:
        options['executable_path'] = configured
    elif windows_chrome.exists():
        options['executable_path'] = str(windows_chrome)
    return playwright.chromium.launch(**options)
