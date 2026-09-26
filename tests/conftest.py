"""Shared test fixtures for $PROJECT_NAME."""

import pytest
from pathlib import Path


@pytest.fixture
def tmp_project(tmp_path):
    """Create a temporary project directory for testing."""
    project_dir = tmp_path / "test_project"
    project_dir.mkdir()
    return project_dir


@pytest.fixture
def sample_data(tmp_path):
    """Create sample data files for testing."""
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    return data_dir
