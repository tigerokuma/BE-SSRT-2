from dataclasses import dataclass, field
from typing import Optional, List, Callable

@dataclass
class LanguageConfig:
    """Configuration for language-specific Tree-sitter parsing."""

    name: str
    file_extensions: List[str]

    # AST node type mappings to semantic concepts
    function_node_types: list[str]
    class_node_types: list[str]
    module_node_types: list[str]
    call_node_types: list[str] = field(default_factory=list)

    # Field names for extracting names
    if_node_types: List[str] = field(default_factory=list)
    loop_node_types: List[str] = field(default_factory=list)
    switch_node_types: List[str] = field(default_factory=list)
    try_node_types: List[str] = field(default_factory=list)
    catch_node_types: List[str] = field(default_factory=list)
    block_node_types: List[str] = field(default_factory=list)

    # field names
    name_field: str = "name"
    body_field: str = "body"
    then_field_names: List[str] = field(default_factory=lambda: ["consequence", "then", "body"])
    else_field_names: List[str] = field(default_factory=lambda: ["alternative", "else"])

    package_indicators: List[str] = field(default_factory=list)

    materialize_named_by_default: bool = True
    whitelist_node_types: List[str] = field(default_factory=list)

    def is_statement(self, node) -> bool:
        return getattr(node, "is_named", False) and not str(getattr(node, "type", "")).endswith("comment")

# Language configurations
LANGUAGE_CONFIGS = {
    "python": LanguageConfig(
        name="python",
        file_extensions=[".py"],
        function_node_types=["function_definition"],
        class_node_types=["class_definition"],
        module_node_types=["module"],
        call_node_types=["call"],
        if_node_types=["if_statement"],
        loop_node_types=["for_statement", "while_statement"],
        switch_node_types=[],
        try_node_types=["try_statement"],
        catch_node_types=["except_clause"],
        block_node_types=["block", "suite", "module"],
        name_field="name",
        body_field="body",
        then_field_names=["consequence", "body"],
        else_field_names=["alternative", "else"],
        package_indicators=["__init__.py"],
    ),
    "javascript": LanguageConfig(
        name="javascript",
        file_extensions=[".js", ".jsx"],
        function_node_types=["function_declaration", "arrow_function", "method_definition"],
        class_node_types=["class_declaration"],
        module_node_types=["program"],
        call_node_types=["call_expression", "new_expression"],
        if_node_types=["if_statement"],
        loop_node_types=["for_statement", "while_statement", "do_statement", "for_in_statement", "for_of_statement"],
        switch_node_types=["switch_statement", "switch_case", "switch_default"],
        try_node_types=["try_statement"],
        catch_node_types=["catch_clause"],
        block_node_types=["statement_block", "program"],
        name_field="name",
        body_field="body",
        then_field_names=["consequence"],
        else_field_names=["alternative", "else"],
    ),
    "typescript": LanguageConfig(
        name="typescript",
        file_extensions=[".ts", ".tsx"],
        function_node_types=["function_declaration", "arrow_function", "method_definition"],
        class_node_types=["class_declaration"],
        module_node_types=["program"],
        call_node_types=["call_expression", "new_expression"],
        if_node_types=["if_statement"],
        loop_node_types=["for_statement", "while_statement", "do_statement", "for_in_statement", "for_of_statement"],
        switch_node_types=["switch_statement", "switch_case", "switch_default"],
        try_node_types=["try_statement"],
        catch_node_types=["catch_clause"],
        block_node_types=["statement_block", "program"],
        name_field="name",
        body_field="body",
        then_field_names=["consequence"],
        else_field_names=["alternative", "else"],
    ),
    "rust": LanguageConfig(
        name="rust",
        file_extensions=[".rs"],
        function_node_types=["function_item"],
        class_node_types=["struct_item", "enum_item", "impl_item"],
        module_node_types=["source_file"],
        call_node_types=["call_expression"],
        if_node_types=["if_expression", "if_let_expression"],
        loop_node_types=["loop_expression", "while_expression", "for_expression"],
        switch_node_types=["match_expression"],
        try_node_types=[],
        catch_node_types=[],
        block_node_types=["block", "source_file"],
        name_field="name",
        body_field="body",
    ),
    "go": LanguageConfig(
        name="go",
        file_extensions=[".go"],
        function_node_types=["function_declaration", "method_declaration"],
        class_node_types=["type_declaration"],
        module_node_types=["source_file"],
        call_node_types=["call_expression"],
        if_node_types=["if_statement"],
        loop_node_types=["for_statement", "range_clause"],
        switch_node_types=["switch_statement", "type_switch_statement"],
        try_node_types=[],
        catch_node_types=[],
        block_node_types=["block", "source_file"],
        name_field="name",
        body_field="body",
    ),
    "scala": LanguageConfig(
        name="scala",
        file_extensions=[".scala", ".sc"],
        function_node_types=["function_definition", "function_declaration"],
        class_node_types=["class_definition", "object_definition", "trait_definition", "case_class_definition"],
        module_node_types=["compilation_unit"],
        call_node_types=["call_expression", "generic_function", "field_expression", "infix_expression"],
        if_node_types=["if_expression"],
        loop_node_types=["for_expression", "while_expression", "do_while_expression"],
        switch_node_types=["match_expression"],
        try_node_types=["try_expression"],
        catch_node_types=["catch_clause"],
        block_node_types=["block", "compilation_unit"],
        name_field="name",
        body_field="body",
    ),
    "java": LanguageConfig(
        name="java",
        file_extensions=[".java"],
        function_node_types=["method_declaration", "constructor_declaration"],
        class_node_types=["class_declaration", "interface_declaration", "enum_declaration", "annotation_type_declaration"],
        module_node_types=["program"],
        call_node_types=["method_invocation", "object_creation_expression"],
        if_node_types=["if_statement"],
        loop_node_types=["for_statement", "enhanced_for_statement", "while_statement", "do_statement"],
        switch_node_types=["switch_expression", "switch_statement", "switch_label"],
        try_node_types=["try_statement"],
        catch_node_types=["catch_clause"],
        block_node_types=["block", "program"],
        name_field="name",
        body_field="body",
    ),
    "cpp": LanguageConfig(
        name="cpp",
        file_extensions=[".cpp", ".h", ".hpp", ".cc", ".cxx", ".hxx", ".hh"],
        function_node_types=["function_definition"],
        class_node_types=["class_specifier", "struct_specifier", "union_specifier", "enum_specifier"],
        module_node_types=["translation_unit", "namespace_definition"],
        call_node_types=["call_expression"],
        if_node_types=["if_statement"],
        loop_node_types=["for_statement", "while_statement", "do_statement"],
        switch_node_types=["switch_statement"],
        try_node_types=["try_statement"],
        catch_node_types=["catch_clause"],
        block_node_types=["compound_statement", "translation_unit", "namespace_definition"],
        name_field="name",
        body_field="body",
    ),
"markdown": LanguageConfig(
        name="markdown",
        file_extensions=[".md", ".markdown", ".mdx"],
        # markdown has no functions/classes/calls
        function_node_types=[],
        class_node_types=[],
        module_node_types=["document"],
        call_node_types=[],
        if_node_types=[],
        loop_node_types=[],
        switch_node_types=[],
        try_node_types=[],
        catch_node_types=[],
        # big building blocks we care about
        block_node_types=["document"],
        # only materialize whitelisted nodes
        materialize_named_by_default=False,
        whitelist_node_types=[
            # core structure (tree-sitter-markdown)
            "document",
            "atx_heading",
            "setext_heading",
            "paragraph",
            "fenced_code_block",
            "indented_code_block",
            "list",
            "list_item",
            "block_quote",
            "thematic_break",
            "html_block",
            # optional inline things you may want to see
            "link",
            "image",
            # if you use a GFM grammar, you can add:
            # "table", "table_row", "table_cell",
        ],
        # name/body fields aren’t used for markdown
        name_field="name",
        body_field="body",
    ),
}


def get_language_config(file_extension: str) -> LanguageConfig | None:
    """Get language configuration based on file extension."""
    for config in LANGUAGE_CONFIGS.values():
        if file_extension in config.file_extensions:
            return config
    return None


def get_language_config_by_name(language_name: str) -> LanguageConfig | None:
    """Get language configuration by language name."""
    return LANGUAGE_CONFIGS.get(language_name.lower())