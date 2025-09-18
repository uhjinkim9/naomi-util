"use client";
import { useMemo, useState } from "react";

type Field = {
  name: string;
  tsType: string;
  optional: boolean;
  decorators: string[];
  rawColumnMeta?: string; // contents inside @Column({ ... })
};

type ParsedEntity = {
  className: string; // e.g., DocEntity
  baseName: string; // e.g., Doc
  fields: Field[];
};

function parseEntity(source: string): ParsedEntity | null {
  const classMatch = source.match(/export\s+class\s+(\w+)/);
  const className = classMatch?.[1];
  if (!className) return null;
  const baseName = className.replace(/Entity$/, "");

  // Rough parse: find property blocks with decorators and a line like: name: type;
  const lines = source.split(/\r?\n/);
  const fields: Field[] = [];
  let decoratorBuf: string[] = [];
  let pendingColumnMeta: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("@")) {
      decoratorBuf.push(line);
      // capture Column meta between @Column({ ... }) possibly spanning multiple lines
      if (line.startsWith("@Column(")) {
        let meta = "";
        if (line.includes("{")) {
          // accumulate until matching close paren
          let depth = 0;
          for (let j = i; j < lines.length; j++) {
            const l = lines[j];
            meta += (meta ? "\n" : "") + l;
            depth += (l.match(/\(/g) || []).length;
            depth -= (l.match(/\)/g) || []).length;
            if (depth <= 0) {
              i = j; // advance outer loop
              break;
            }
          }
          pendingColumnMeta = meta;
        }
      }
      continue;
    }

    // Avoid named capture groups for wider compatibility
    const propMatch = line.match(/^(?:public\s+|private\s+|readonly\s+)?([A-Za-z_][A-Za-z0-9_]*)\??:\s*([^;]+);/);
    if (propMatch) {
      const name = propMatch[1];
      const tsType = propMatch[2].trim();
      const optional = /\?$/.test(propMatch[0]) || /nullable\s*:\s*true/.test((pendingColumnMeta || "") + "\n" + decoratorBuf.join("\n"));
      fields.push({ name, tsType, optional, decorators: decoratorBuf.slice(), rawColumnMeta: pendingColumnMeta });
      decoratorBuf = [];
      pendingColumnMeta = undefined;
    }
  }

  return { className, baseName, fields };
}

function isRelation(field: Field) {
  return field.decorators.some((d) => /@(OneToOne|OneToMany|ManyToOne|ManyToMany|JoinColumn|JoinTable)\b/.test(d));
}

function isGeneratedPrimary(field: Field) {
  return field.decorators.some((d) => /@PrimaryGeneratedColumn\b/.test(d));
}

function isAudit(field: Field) {
  return field.decorators.some((d) => /@(CreateDateColumn|UpdateDateColumn|DeleteDateColumn)\b/.test(d));
}

function isTinyIntBoolean(field: Field) {
  const meta = field.rawColumnMeta || "";
  return /@Column\(/.test(meta) && /type\s*:\s*['\"]tinyint['\"]/i.test(meta) && /width\s*:\s*1\b/.test(meta);
}

function mapTsType(field: Field) {
  // Keep original TS type unless we coerce tinyint(1) booleans to number as in example
  const t = field.tsType.trim();
  return t;
}

function getValidatorDecorators(field: Field, required: boolean) {
  const decos: string[] = [];
  const t = field.tsType.replace(/\s+/g, "");
  const columnMeta = field.rawColumnMeta || "";

  // Enum
  if (/Enum\b/.test(t)) {
    decos.push(`@IsEnum(${field.tsType.trim()})`);
  } else if (t === "string") {
    decos.push("@IsString()");
  } else if (t === "Date") {
    decos.push("@IsDate()");
  } else if (t === "number") {
    // Prefer IsInt for int-like columns
    if (/type\s*:\s*['\"][a-z]*int['\"]/i.test(columnMeta)) decos.push("@IsInt()");
    else decos.push("@IsInt()");
  }

  if (!required) decos.push("@IsOptional()");
  if (required && t === "string") decos.push("@IsNotEmpty()");

  return decos;
}

function extractEnumImports(source: string, fields: Field[]): string[] {
  const enumTypeNames = new Set<string>();
  for (const f of fields) {
    const t = f.tsType.trim();
    if (/\bEnum\b/.test(t) || /Enum$/.test(t)) {
      enumTypeNames.add(t);
    }
  }
  const importLines = source
    .split(/\r?\n/)
    .filter((l) => l.trim().startsWith("import"));
  // Conservative: include any import line that mentions one of enum names
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

function genDocDto(source: string, parsed: ParsedEntity, opts: { forceOptional: boolean; stripAudit: boolean }) {
  const className = `${parsed.baseName}Dto`;
  const lines: string[] = [];
  lines.push(
    "import { IsString, IsOptional, IsInt, IsNotEmpty, IsDate, IsEnum } from 'class-validator';",
    "import { Transform } from 'class-transformer';",
    "import { PartialType } from '@nestjs/mapped-types';",
    "import { CommonDto } from 'src/common/dto/common.dto';",
    "import { boolTransformer, dateTransformer } from 'src/common/util/transformer';",
    ...extractEnumImports(source, parsed.fields),
    "",
    `export class ${className} extends CommonDto {`
  );

  const fields = parsed.fields.filter((f) => !isRelation(f) && !isAudit(f));
  for (const f of fields) {
    const isRequired = !opts.forceOptional && !f.optional && !isGeneratedPrimary(f);
    const t = mapTsType(f);

    // Transformers
    const isTiny = isTinyIntBoolean(f);
    const isDateType = t === "Date" || /type\s*:\s*['\"][a-z]*date/.test(f.rawColumnMeta || "");
    if (isTiny) lines.push(`  @Transform(({ value }) => boolTransformer.to(value))`);
    if (isDateType) lines.push(`  @Transform(({ value }) => dateTransformer.to(value))`);

    // Validators
    for (const d of getValidatorDecorators(f, !isRequired)) {
      lines.push(`  ${d}`);
    }

    lines.push(`  ${f.name}: ${isTiny ? "number" : t};`, "");
  }

  lines.push("}");

  // Request DTO extends PartialType
  lines.push("", `export class ${parsed.baseName}ReqDto extends PartialType(${className}) {}`);

  return lines.join("\n");
}

function genResponseDto(source: string, parsed: ParsedEntity) {
  const className = `${parsed.baseName}ResDto`;
  const lines: string[] = [];
  lines.push(
    "import { Expose, Transform } from 'class-transformer';",
    "import { boolTransformer, dateTransformer } from 'src/common/util/transformer';",
    ...extractEnumImports(source, parsed.fields),
    "",
    `export class ${className} {`
  );

  const isAuditField = (f: Field) => isAudit(f);
  const fields = parsed.fields; // include relations for response DTO
  for (const f of fields) {
    const relation = isRelation(f);
    const isTiny = isTinyIntBoolean(f);
    const isDateColumn = f.tsType.trim() === "Date" || /type\s*:\s*['\"][a-z]*date/.test(f.rawColumnMeta || "");
    const audit = isAuditField(f);

    // For relations, only expose without transforms
    if (!relation) {
      if (isTiny) lines.push(`  @Transform(({ value }) => boolTransformer.from(value))`);
      if (!audit && isDateColumn) lines.push(`  @Transform(({ value }) => dateTransformer.from(value))`);
    }
    lines.push("  @Expose()");

    const typeStr = relation
      ? toRelationResDtoType(f.tsType.trim())
      : isTiny
      ? "boolean"
      : audit && isDateColumn
      ? "Date"
      : isDateColumn
      ? "string"
      : f.tsType.trim();
    lines.push(`  ${f.name}: ${typeStr};`, "");
  }

  lines.push("}");
  return lines.join("\n");
}

function toRelationResDtoType(tsType: string): string {
  const t = tsType.trim();
  // Array<Type>
  const arrayGeneric = t.match(/^Array<(.+)>$/);
  if (arrayGeneric) {
    return toRelationResDtoType(arrayGeneric[1]) + "[]";
  }
  // Type[]
  if (t.endsWith("[]")) {
    const inner = t.slice(0, -2).trim();
    return toRelationResDtoType(inner) + "[]";
  }
  // Map *Entity -> *ResDto
  return t.replace(/Entity$/, "ResDto");
}

export default function EntityToDtoPage() {
  const [input, setInput] = useState<string>("");
  const [forceOptional, setForceOptional] = useState(true);
  const [stripAudit, setStripAudit] = useState(true);

  const parsed = useMemo(() => (input.trim() ? parseEntity(input) : null), [input]);
  const dtoCode = useMemo(() => (parsed ? genDocDto(input, parsed, { forceOptional, stripAudit }) : ""), [parsed, forceOptional, stripAudit, input]);
  const resDtoCode = useMemo(() => (parsed ? genResponseDto(input, parsed) : ""), [parsed, input]);

  return (
    <div style={{ padding: 16, display: "grid", gap: 16 }}>
      <h2>Entity → DTO Converter</h2>
      <div style={{ display: "grid", gap: 8 }}>
        <label style={{ fontWeight: 600 }}>Entity source</label>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Paste your TypeORM entity (TypeScript) here"
          style={{ width: "100%", height: 220, fontFamily: "monospace", fontSize: 12, padding: 8 }}
        />
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <label><input type="checkbox" checked={stripAudit} onChange={(e) => setStripAudit(e.target.checked)} /> Strip audit fields (created/updated/deleted)</label>
          <label><input type="checkbox" checked={forceOptional} onChange={(e) => setForceOptional(e.target.checked)} /> Force @IsOptional on all fields</label>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ margin: 0 }}>Request DTO (DocDto + DocReqDto)</h3>
            <button onClick={() => navigator.clipboard.writeText(dtoCode)} disabled={!dtoCode}>Copy</button>
          </div>
          <textarea readOnly value={dtoCode} style={{ width: "100%", height: 360, fontFamily: "monospace", fontSize: 12, padding: 8 }} />
        </div>
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ margin: 0 }}>Response DTO (DocResDto)</h3>
            <button onClick={() => navigator.clipboard.writeText(resDtoCode)} disabled={!resDtoCode}>Copy</button>
          </div>
          <textarea readOnly value={resDtoCode} style={{ width: "100%", height: 360, fontFamily: "monospace", fontSize: 12, padding: 8 }} />
        </div>
      </div>

      {!parsed && input.trim() && (
        <div style={{ color: "#a00" }}>Could not parse entity class name. Ensure it uses `export class NameEntity`.</div>
      )}
      {!input.trim() && (
        <div style={{ color: "#666" }}>Paste your entity above. I’ll generate DTOs here.</div>
      )}
    </div>
  );
}
