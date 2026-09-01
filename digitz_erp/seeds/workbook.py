# Copyright (c) 2026, Rupesh P and contributors
# For license information, please see license.txt

"""Shared spreadsheet reading for the seeds in this package.

Columns are located by header name rather than by position, so reordering or
inserting columns in the master data sheet does not break a seed.
"""

import openpyxl

import frappe


def load_sheet(file_path, sheet=None):
	"""Return (header tuple, list of row tuples) for one sheet.

	Read fully into memory and closed straight away: the master data sheet is
	small, and holding the file open blocks the person editing it.
	"""
	workbook = openpyxl.load_workbook(file_path, data_only=True, read_only=True)

	try:
		worksheet = workbook[sheet] if sheet else workbook.worksheets[0]
		rows = list(worksheet.iter_rows(values_only=True))
		title = worksheet.title
	finally:
		workbook.close()

	if not rows:
		frappe.throw(f"Sheet '{title}' in {file_path} is empty.")

	return rows[0], rows[1:]


def column_index(header, name):
	"""Position of `name` in the header, matched case and space insensitively."""
	wanted = " ".join(str(name).split()).lower()

	for position, cell_value in enumerate(header):
		if cell_value is None:
			continue

		if " ".join(str(cell_value).split()).lower() == wanted:
			return position

	return None


def require_columns(header, names, file_path, sheet_hint=""):
	"""Map each wanted header to its position, or throw naming what is missing."""
	indexes = {}
	missing = []

	for name in names:
		position = column_index(header, name)

		if position is None:
			missing.append(name)
		else:
			indexes[name] = position

	if missing:
		found = ", ".join(str(c) for c in header if c is not None)
		frappe.throw(
			f"Missing column(s) {', '.join(repr(m) for m in missing)} in {file_path}"
			f"{sheet_hint}. Found: {found}"
		)

	return indexes


def text(row, index):
	"""Trimmed cell text, or None when the cell is empty.

	Numeric codes arrive from openpyxl as int/float, so everything is coerced
	to str; a whole number is rendered without the '.0' that str() would add.
	"""
	if index is None or index >= len(row):
		return None

	value = row[index]

	if value is None:
		return None

	if isinstance(value, float) and value.is_integer():
		value = int(value)

	value = str(value).strip()

	return value or None
