# digitz_erp/api/test_token_api.py

import frappe

@frappe.whitelist(allow_guest=True)
def mock_tokens(username=None, timestamp=None, last_token_no=None):
    return [
        {
            "TokenNumber": 29,
            "UserName": "reception2",
            "ApplicationNumber": "F470680Z001V3Q",
            "Nationality": None,
            "DOB": None,
            "Gender": "MALE",
            "Mobile": "0544231306",
            "Name": "MUHAMMAD YASEEN",
            "Service": "Pre-Typing (Medical Examination)",
            "CreatedDate": "2026-04-01T12:01:38.3952657",
            "VisitDate": "2026-04-01T12:01:38.3952657",
            "CustomerId": None,
            "CompanyId": None,
            "Email": None,
            "WhatsApp": None
        }
    ]