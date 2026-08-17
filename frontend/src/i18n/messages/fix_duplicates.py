#!/usr/bin/env python3
"""
Script to fix duplicate keys in JSON translation files.
Reads JSON with duplicate keys and merges them properly.
"""
import json
import re
from collections import OrderedDict

def parse_json_with_duplicates(file_path):
    """Parse JSON and detect duplicate keys at all levels."""
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Parse JSON using a custom decoder that tracks duplicates
    def object_pairs_hook(pairs):
        result = OrderedDict()
        for key, value in pairs:
            if key in result:
                # Merge duplicate keys
                if isinstance(result[key], dict) and isinstance(value, dict):
                    # Merge nested dictionaries
                    result[key] = merge_dicts(result[key], value)
                else:
                    # For non-dict values, keep the later value
                    print(f"  Warning: Duplicate primitive key '{key}', keeping last value")
                    result[key] = value
            else:
                result[key] = value
        return result
    
    data = json.loads(content, object_pairs_hook=object_pairs_hook)
    return data

def merge_dicts(dict1, dict2):
    """Recursively merge two dictionaries, with dict2 values taking precedence."""
    result = dict1.copy()
    for key, value in dict2.items():
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = merge_dicts(result[key], value)
        else:
            result[key] = value
    return result

def main():
    print("Fixing en.json...")
    en_data = parse_json_with_duplicates('en.json')
    
    with open('en_fixed.json', 'w', encoding='utf-8') as f:
        json.dump(en_data, f, ensure_ascii=False, indent=2)
    print(f"  Fixed file saved to en_fixed.json")
    print(f"  Total top-level keys: {len(en_data)}")
    
    print("\nFixing fr.json...")
    fr_data = parse_json_with_duplicates('fr.json')
    
    with open('fr_fixed.json', 'w', encoding='utf-8') as f:
        json.dump(fr_data, f, ensure_ascii=False, indent=2)
    print(f"  Fixed file saved to fr_fixed.json")
    print(f"  Total top-level keys: {len(fr_data)}")
    
    print("\nDone! Please review the _fixed.json files before replacing the originals.")

if __name__ == "__main__":
    main()
