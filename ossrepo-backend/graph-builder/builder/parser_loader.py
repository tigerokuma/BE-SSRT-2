from collections.abc import Callable
from typing import Any

from loguru import logger
from tree_sitter import Language, Parser

from .language_config import LANGUAGE_CONFIGS

# Define a type for the language library loaders
LanguageLoader = Callable[[], object] | None


# Import available Tree-sitter languages and correctly type them as Optional
def _import_language_loaders() -> dict[str, LanguageLoader]:
    """Import language loaders with proper error handling and typing."""
    loaders: dict[str, LanguageLoader] = {}

    try:
        from tree_sitter_python import language as python_language_so
        loaders["python"] = python_language_so
    except ImportError:
        loaders["python"] = None

    try:
        from tree_sitter_javascript import language as javascript_language_so
        loaders["javascript"] = javascript_language_so
    except ImportError:
        loaders["javascript"] = None

    try:
        from tree_sitter_typescript import language_typescript as typescript_language_so
        loaders["typescript"] = typescript_language_so
    except ImportError:
        loaders["typescript"] = None

    try:
        from tree_sitter_rust import language as rust_language_so
        loaders["rust"] = rust_language_so
    except ImportError:
        loaders["rust"] = None

    try:
        from tree_sitter_go import language as go_language_so
        loaders["go"] = go_language_so
    except ImportError:
        loaders["go"] = None

    try:
        from tree_sitter_scala import language as scala_language_so
        loaders["scala"] = scala_language_so
    except ImportError:
        loaders["scala"] = None

    try:
        from tree_sitter_java import language as java_language_so
        loaders["java"] = java_language_so
    except ImportError:
        loaders["java"] = None

    try:
        from tree_sitter_cpp import language as cpp_language_so
        loaders["cpp"] = cpp_language_so
    except ImportError:
        loaders["cpp"] = None

    try:
        from tree_sitter_markdown import language as markdown_language_so
        loaders["markdown"] = markdown_language_so
    except ImportError:
        loaders["markdown"] = None

    return loaders


_language_loaders = _import_language_loaders()
LANGUAGE_LIBRARIES: dict[str, LanguageLoader | None] = _language_loaders


def load_parsers() -> tuple[dict[str, Parser], dict[str, Any]]:
    """Loads all available Tree-sitter parsers and compiles their queries."""
    parsers: dict[str, Parser] = {}
    queries: dict[str, Any] = {}
    available_languages = []

    for lang_name, lang_config in LANGUAGE_CONFIGS.items():
        lang_lib = LANGUAGE_LIBRARIES.get(lang_name)
        if lang_lib:
            try:
                language = Language(lang_lib())
                parser = Parser(language)

                parsers[lang_name] = parser

                # Compile queries -------------------------------------------------
                function_patterns = " ".join(
                    [f"({node_type}) @function" for node_type in lang_config.function_node_types]
                )
                class_patterns = " ".join(
                    [f"({node_type}) @class" for node_type in lang_config.class_node_types]
                )
                call_patterns = " ".join(
                    [f"({node_type}) @call" for node_type in lang_config.call_node_types]
                )

                # --- NEW: import queries (lightweight, per-language) ------------
                imports_patterns = ""
                if lang_name == "python":
                    # Matches:
                    #   import os
                    #   import a as b
                    #   from pkg import x, y as z
                    #   from pkg.sub import x
                    #   from pkg import *
                    imports_patterns = " ".join([
                        # import os | import a as b
                        "(import_statement name: (dotted_name) @module)",
                        "(import_statement name: (dotted_name) @module (aliased_import (identifier) @alias))",
                        # from pkg import x | y as z | dotted names
                        "(import_from_statement module_name: (dotted_name) @module)",
                        "(import_from_statement module_name: (dotted_name) @module (import_list (aliased_import (identifier) @member)))",
                        "(import_from_statement module_name: (dotted_name) @module (import_list (dotted_name (identifier) @member)))",
                        # from pkg import *
                        "(import_from_statement module_name: (dotted_name) @module (wildcard_import))",
                        "(import_from_statement (relative_import) @module)",
                        "(import_from_statement (relative_import) @module (import_list (aliased_import (identifier) @member)))",
                    ])

                elif lang_name in ("javascript", "typescript"):
                    # Matches:
                    #   import X from 'm'
                    #   import {a as b} from "m"
                    #   import * as ns from 'm'
                    #   const x = require('m')
                    imports_patterns = " ".join([
                        "(import_statement source: (string) @module)",
                        "(import_statement (import_clause (named_imports (import_specifier (identifier) @member))) source: (string) @module)",
                        "(import_statement (import_clause (namespace_import (identifier) @alias)) source: (string) @module)",
                        # require()
                        "(lexical_declaration (variable_declarator (call_expression function: (identifier) @req args: (arguments (string) @module))))",
                    ])
                # -----------------------------------------------------------------

                queries[lang_name] = {
                    "functions": language.query(function_patterns) if function_patterns.strip() else None,
                    "classes": language.query(class_patterns) if class_patterns.strip() else None,
                    "calls": language.query(call_patterns) if call_patterns.strip() else None,
                    # NEW: compiled imports query (may be None if not defined)
                    "imports": language.query(imports_patterns) if imports_patterns.strip() else None,
                    "config": lang_config,
                }

                available_languages.append(lang_name)
                logger.success(f"Successfully loaded {lang_name} grammar.")
            except Exception as e:
                logger.warning(f"Failed to load {lang_name} grammar: {e}")
        else:
            logger.debug(f"Tree-sitter library for {lang_name} not available.")

    if not available_languages:
        raise RuntimeError("No Tree-sitter languages available.")

    logger.info(f"Initialized parsers for: {', '.join(available_languages)}")
    return parsers, queries
