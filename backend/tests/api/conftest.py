"""Fixtures shared by the tests of the API."""

import pytest

from tests.months import Months, current_months


@pytest.fixture
def months() -> Months:
    """The current month of the space and its neighbours, read from the clock at the test start."""
    return current_months()
