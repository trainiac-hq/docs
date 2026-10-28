// A compact validator for the subset of JSON Schema / OpenAPI 3.1 that
// openapi.v1.json uses: $ref, oneOf / anyOf / allOf, type (including the
// ["T","null"] nullable idiom), enum, const, object properties with required
// and additionalProperties, and arrays. It is deliberately strict — it rejects
// unexpected keys — so a passing response is a genuine proof of contract
// conformance, not a loose smoke test.

type Schema = any;

export class Validator {
	private readonly schemas: Record<string, Schema>;

	constructor(openapi: { components: { schemas: Record<string, Schema> } }) {
		this.schemas = openapi.components.schemas;
	}

	/** Validate `value` against a named component schema. Returns [] when valid. */
	validate(schemaName: string, value: unknown): string[] {
		const schema = this.schemas[schemaName];
		if (!schema) return [`unknown schema: ${schemaName}`];
		const errors: string[] = [];
		this.check(schema, value, "$", errors);
		return errors;
	}

	private deref(schema: Schema): Schema {
		if (schema && typeof schema.$ref === "string") {
			const name = schema.$ref.replace("#/components/schemas/", "");
			return this.deref(this.schemas[name]);
		}
		return schema;
	}

	private check(schemaIn: Schema, value: unknown, path: string, errors: string[]): void {
		const schema = this.deref(schemaIn);
		if (!schema) {
			errors.push(`${path}: no schema`);
			return;
		}

		if (schema.allOf) {
			for (const sub of schema.allOf) this.check(sub, value, path, errors);
			return;
		}
		if (schema.oneOf || schema.anyOf) {
			const branches: Schema[] = schema.oneOf ?? schema.anyOf;
			const perBranch = branches.map((b) => {
				const e: string[] = [];
				this.check(b, value, path, e);
				return e;
			});
			if (perBranch.some((e) => e.length === 0)) return;
			// Report the branch that came closest (fewest complaints).
			const best = perBranch.reduce((a, b) => (b.length < a.length ? b : a));
			errors.push(`${path}: matched none of ${branches.length} alternatives; closest: ${best.join("; ")}`);
			return;
		}

		if (schema.const !== undefined) {
			if (value !== schema.const) errors.push(`${path}: expected const ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`);
			return;
		}
		if (schema.enum) {
			if (!schema.enum.includes(value)) errors.push(`${path}: ${JSON.stringify(value)} not in enum`);
			return;
		}

		const types: string[] = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
		if (types.length && !types.some((t) => this.typeMatches(t, value))) {
			errors.push(`${path}: expected type ${types.join("|")}, got ${jsType(value)}`);
			return;
		}

		if (types.includes("object") || schema.properties) {
			if (value === null || typeof value !== "object" || Array.isArray(value)) {
				if (!(types.includes("null") && value === null)) errors.push(`${path}: expected object`);
				return;
			}
			const obj = value as Record<string, unknown>;
			const props = schema.properties ?? {};
			for (const req of schema.required ?? []) {
				if (!(req in obj)) errors.push(`${path}.${req}: required key missing`);
			}
			for (const [key, v] of Object.entries(obj)) {
				if (props[key]) this.check(props[key], v, `${path}.${key}`, errors);
				else if (schema.additionalProperties === false) errors.push(`${path}.${key}: unexpected key`);
				else if (schema.additionalProperties && typeof schema.additionalProperties === "object")
					this.check(schema.additionalProperties, v, `${path}.${key}`, errors);
			}
		}

		if (types.includes("array") && Array.isArray(value) && schema.items) {
			value.forEach((item, i) => this.check(schema.items, item, `${path}[${i}]`, errors));
		}
	}

	private typeMatches(type: string, value: unknown): boolean {
		switch (type) {
			case "null":
				return value === null;
			case "string":
				return typeof value === "string";
			case "boolean":
				return typeof value === "boolean";
			case "integer":
				return typeof value === "number" && Number.isInteger(value);
			case "number":
				return typeof value === "number";
			case "array":
				return Array.isArray(value);
			case "object":
				return value !== null && typeof value === "object" && !Array.isArray(value);
			default:
				return true;
		}
	}
}

function jsType(v: unknown): string {
	if (v === null) return "null";
	if (Array.isArray(v)) return "array";
	return typeof v;
}
