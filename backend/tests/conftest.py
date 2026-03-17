"""
Pytest configuration for backend tests.

Prevents collection of files with spaces in their names (invalid Python module
identifiers that would cause ImportError during collection).
"""

# Files matching these globs are excluded from collection.
collect_ignore_glob = ["* *.py"]
