"""Expand authored Surface cases into a new directory for the native probe.

This prepares inputs only; it does not execute the original application.
"""
import argparse
import copy
import json
import re
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--cases', type=Path, help='Explicit authored case fixture')
options = parser.parse_args()
source = options.cases or Path(__file__).with_name('seams-camera-cases.json')
fixture = json.loads(source.read_text())
names = [case['name'] for case in fixture['cases']]
if not 0 < len(names) <= 40 or len(set(names)) != len(names):
    raise ValueError('Expected distinct bounded case names')
if any(not re.fullmatch('[a-z0-9-]+', name) for name in names):
    raise ValueError('Invalid case name')
output = options.output.resolve()
output.mkdir(parents=True, exist_ok=False)
(output / 'inputs').mkdir()
for case in fixture['cases']:
    descriptor = copy.deepcopy(fixture['base'])
    descriptor['name'] = case['name']
    project = descriptor['project']
    project['name'] = case['name']
    project['equations'] = case['equations']
    project['camera'] = case['camera']
    project['settings'].update(case['settings'])
    for key in ['parameters', 'timeline']:
        if key in case:
            project[key] = case[key]
    (output / 'inputs' / (case['name'] + '.json')).write_text(
        json.dumps(descriptor, indent=2) + '\n')
(output / 'cases.json').write_text(json.dumps(names) + '\n')
print(json.dumps({'cases': len(names), 'output': str(output)}))
