# Copyright (c) 2026, Rupesh P and contributors
# For license information, please see license.txt

"""The in-app Help Center (the digitz-help desk page).

Guides are Markdown files in digitz_erp/help/topics/, listed and grouped by
digitz_erp/help/topics.json. To add a guide, drop a .md file there and add an
entry to the index; nothing else changes. Links between guides are written as
`[text](#topic-name)`, rendered as a link to that topic's route.

Only names in the index are ever read, so a topic name cannot reach outside the
help folder.
"""

import json
import os
import re

import frappe
from frappe.utils import md_to_html

HELP_DIR = frappe.get_app_path("digitz_erp", "help")


def load_index():
	with open(os.path.join(HELP_DIR, "topics.json")) as f:
		return json.load(f)


def read_topic(name):
	with open(os.path.join(HELP_DIR, "topics", f"{name}.md")) as f:
		return f.read()


def ordered_topics(index):
	return [topic for group in index for topic in group["topics"]]


@frappe.whitelist()
def get_help_index():
	"""Groups of topics, each with its plain text for the page's search."""
	index = load_index()
	for group in index:
		for topic in group["topics"]:
			topic["text"] = read_topic(topic["name"])
	return index


def link_topics(html, names):
	"""Turn `#topic-name` links into desk routes, so the router handles them like any link."""
	return re.sub(
		r'href="#([a-z0-9-]+)"',
		lambda m: f'href="/app/digitz-help/{m.group(1)}"' if m.group(1) in names else m.group(0),
		html,
	)


def fold_sections(html):
	"""Wrap each `## heading` and what follows it in <details>, so the guide opens
	as a list of headings the reader expands one at a time. The paragraph right
	under a heading is its gist and stays visible under the heading; the rest folds."""
	intro, *sections = re.split(r"(?=<h2[ >])", html)
	folded = []
	for section in sections:
		m = re.match(r"<h2([^>]*)>(.*?)</h2>\s*(?:<p>(.*?)</p>)?(.*)", section, re.S)
		attrs, title, gist, body = m.groups()
		gist = f'<span class="dzh-gist">{gist}</span>' if gist else ""
		folded.append(
			f'<details class="dzh-section"{attrs}><summary><span class="dzh-title">{title}</span>{gist}</summary>{body}</details>'
		)
	return intro + "".join(folded)


@frappe.whitelist()
def get_help_topic(name):
	"""One guide as HTML, with its neighbours for Previous / Next."""
	topics = ordered_topics(load_index())
	names = [t["name"] for t in topics]
	if name not in names:
		frappe.throw(f"There is no help topic called {name}.", frappe.DoesNotExistError)

	position = names.index(name)
	topic = topics[position]
	neighbour = lambda i: {"name": topics[i]["name"], "title": topics[i]["title"]} if 0 <= i < len(topics) else None

	html = link_topics(md_to_html(read_topic(name)), names)
	if topic.get("collapsible"):
		html = fold_sections(html)

	return {
		"name": name,
		"title": topic["title"],
		"html": html,
		"previous": neighbour(position - 1),
		"next": neighbour(position + 1),
	}
