# Maharashtra source research used for the prototype

This is a synthetic prototype, not a copy of government databases.

Key official observations used in the model:

1. Mahabhulekh exposes 7/12, 8A, Property Card and K-Prat. The 7/12 flow uses District, Taluka, Village and Survey/Gat Number and exposes Survey Number/Part; the portal specifically notes area, area unit, khatedar name and khatedar area as record attributes that may require correction.
2. Maharashtra's official FAQ describes 8A (Village Form 8A / Khata) as an account containing a holder's land by land-measurement number and records of land revenue plus cultivable/non-cultivable area.
3. e-Ferfar is an online mutation system. Official Maharashtra material describes mutation entries from registered documents, orders, and citizen e-Hakk applications; approved mutations update 7/12 and 8A.
4. Property Card is a separate record stream, with CTS/city-survey concepts. Maharashtra's services include Property Card, CTS/Survey-number lookup and jurisdiction lookup.
5. Mahabhunakasha provides maps linked with land records; official Maharashtra material describes searchable survey/CTS metadata and links between cadastral maps and 7/12.
6. Maharashtra official material states that ULPIN (Unique Land Parcel Identification Number) is used as a unique parcel identifier, and a 2023 circular addresses new survey/sub-division numbering after ULPIN.
7. The official land-record department also exposes APIs for rights records to government/semi-government offices and other organizations, supporting the prototype's later API-integration direction.
8. The Registration & Stamps department is a separate Maharashtra department; the synthetic registration model therefore keeps document/SRO/transaction information separate from land-record mutation data.

Important modeling interpretation:
- ULPIN is the central parcel link.
- Survey/Gat/Khasra, CTS No., Property UID, Ferfar No. and Registration/Document No. remain source-specific identifiers.
- Marathi values are source-like representations; English values are transliterations/normalized labels for interoperability.
