from typing import Annotated

from pydantic import BaseModel, ConfigDict, StringConstraints

# Format only (ISO 4217 alpha code). Whether the currency is supported is the `currencies`
# table's call (service.get_currency / FK). Rust regex: `$` does not match before a final \n.
CurrencyCode = Annotated[str, StringConstraints(strict=True, pattern=r"^[A-Z]{3}$")]


class CurrencyRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    code: CurrencyCode
    exponent: int
