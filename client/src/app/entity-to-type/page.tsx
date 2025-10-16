"use client";
import {useMemo, useState} from "react";

type Field = {
  name: string;
  tsType: string;
  optional: boolean;
  decorators: string[];
  rawColumnMeta?: string;
};

type ParsedEntity = {
  className: string;
  baseName: string;
  fields: Field[];
};

function parseEntity(source: string): ParsedEntity | null {
  const classMatch = source.match(/export\s+class\s+(\w+)/);
  const className = classMatch?.[1];
  if (!className) return null;
  const baseName = className.replace(/Entity$/, "");

  const lines = source.split(/\r?\n/);
  const fields: Field[] = [];
  let decoratorBuf: string[] = [];
  let pendingColumnMeta: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("@")) {
      decoratorBuf.push(line);
      if (line.startsWith("@Column(")) {
        let meta = "";
        if (line.includes("{")) {
          let depth = 0;
          for (let j = i; j < lines.length; j++) {
            const l = lines[j];
            meta += (meta ? "\n" : "") + l;
            depth += (l.match(/\(/g) || []).length;
            depth -= (l.match(/\)/g) || []).length;
            if (depth <= 0) {
              i = j;
              break;
            }
          }
          pendingColumnMeta = meta;
        }
      }
      continue;
    }

    const propMatch = line.match(/^(?:public\s+|private\s+|readonly\s+)?([A-Za-z_][A-Za-z0-9_]*)\??:\s*([^;]+);/);
    if (propMatch) {
      const name = propMatch[1];
      const tsType = propMatch[2].trim();
      const optional =
        /\?$/.test(propMatch[0]) ||
        /nullable\s*:\s*true/.test((pendingColumnMeta || "") + "\n" + decoratorBuf.join("\n"));
      fields.push({
        name,
        tsType,
        optional,
        decorators: decoratorBuf.slice(),
        rawColumnMeta: pendingColumnMeta,
      });
      decoratorBuf = [];
      pendingColumnMeta = undefined;
    }
  }

  return {className, baseName, fields};
}

function isRelation(field: Field) {
  return field.decorators.some((d) =>
    /@(OneToOne|OneToMany|ManyToOne|ManyToMany|JoinColumn|JoinTable)\b/.test(d)
  );
}

function isAudit(field: Field) {
  return field.decorators.some((d) =>
    /@(CreateDateColumn|UpdateDateColumn|DeleteDateColumn)\b/.test(d)
  );
}

function isTinyIntBoolean(field: Field) {
  const meta = field.rawColumnMeta || "";
  return /@Column\(/.test(meta) && /type\s*:\s*['"]tinyint['"]/i.test(meta) && /width\s*:\s*1\b/.test(meta);
}

function extractEnumImports(source: string, fields: Field[]): string[] {
  const enumTypeNames = new Set<string>();
  for (const f of fields) {
    const t = f.tsType.trim();
    if (/\bEnum\b/.test(t) || /Enum$/.test(t)) {
      enumTypeNames.add(t);
    }
  }
  const importLines = source.split(/\r?\n/).filter((l) => l.trim().startsWith("import"));
  const selected: string[] = [];
  for (const line of importLines) {
    for (const name of Array.from(enumTypeNames)) {
      if (line.includes(name)) {
        selected.push(line);
        break;
      }
    }
  }
  return Array.from(new Set(selected));
}

function toRelationResDtoType(tsType: string): string {
  const t = tsType.trim();
  const arrayGeneric = t.match(/^Array<(.+)>$/);
  if (arrayGeneric) {
    return toRelationResDtoType(arrayGeneric[1]) + "[]";
  }
  if (t.endsWith("[]")) {
    const inner = t.slice(0, -2).trim();
    return toRelationResDtoType(inner) + "[]";
  }
  // Map *Entity -> *Type for relations (including arrays)
  return t.replace(/Entity$/, "Type");
}

function getResponseFieldType(field: Field): string {
  const relation = isRelation(field);
  if (relation) {
    return toRelationResDtoType(field.tsType.trim());
  }

  const baseType = field.tsType.trim();
  const isTiny = isTinyIntBoolean(field);
  if (isTiny) return "boolean";

  const isDateColumn =
    baseType === "Date" || /type\s*:\s*['"][a-z]*date/.test(field.rawColumnMeta || "");
  if (isAudit(field) && isDateColumn) return "Date";
  if (isDateColumn) return "string";

  // If the field type itself is an Entity (or array of Entities), map to *Type
  const mappedEntityType = toRelationResDtoType(baseType);
  if (mappedEntityType !== baseType) return mappedEntityType;

  return baseType;
}

function genEntityType(
  source: string,
  parsed: ParsedEntity,
  opts: {stripAudit: boolean}
) {
  const lines: string[] = [];
  const enumImports = extractEnumImports(source, parsed.fields);
  if (enumImports.length) {
    lines.push(...enumImports, "");
  }

  const typeName = `${parsed.baseName}Type`;
  lines.push(`export type ${typeName} = {`);

  for (const field of parsed.fields) {
    if (opts.stripAudit && isAudit(field)) continue;
    const tsType = getResponseFieldType(field);
    lines.push(`  ${field.name}?: ${tsType};`);
  }

  lines.push("};");
  return lines.join("\n");
}

export default function EntityToTypePage() {
  const [input, setInput] = useState<string>("");
  const [stripAudit, setStripAudit] = useState(true);

  const parsed = useMemo(() => (input.trim() ? parseEntity(input) : null), [input]);
  const typeCode = useMemo(
    () => (parsed ? genEntityType(input, parsed, {stripAudit}) : ""),
    [parsed, stripAudit, input]
  );

  return (
    <div style={{padding: 16, display: "grid", gap: 16}}>
      <h2>Entity → Type Converter</h2>
      <div style={{display: "grid", gap: 8}}>
        <label style={{fontWeight: 600}}>Entity source</label>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Paste your TypeORM entity (TypeScript) here"
          style={{
            width: "100%",
            height: 220,
            fontFamily: "monospace",
            fontSize: 12,
            padding: 8,
          }}
        />
        <div style={{display: "flex", gap: 16, flexWrap: "wrap"}}>
          <label>
            <input
              type="checkbox"
              checked={stripAudit}
              onChange={(e) => setStripAudit(e.target.checked)}
            />{" "}
            Strip audit fields (created/updated/deleted)
          </label>
        </div>
      </div>

      <div style={{display: "grid", gap: 16}}>
        <div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <h3 style={{margin: 0}}>Type Definition</h3>
            <button
              onClick={() => navigator.clipboard.writeText(typeCode)}
              disabled={!typeCode}
            >
              Copy
            </button>
          </div>
          <textarea
            readOnly
            value={typeCode}
            style={{
              width: "100%",
              height: 360,
              fontFamily: "monospace",
              fontSize: 12,
              padding: 8,
            }}
          />
        </div>
      </div>

      {!parsed && input.trim() && (
        <div style={{color: "#a00"}}>
          Could not parse entity class name. Ensure it uses `export class NameEntity`.
        </div>
      )}
      {!input.trim() && (
        <div style={{color: "#666"}}>
          Paste your entity above. I'll generate a TypeScript type here.
        </div>
      )}
    </div>
  );
}


