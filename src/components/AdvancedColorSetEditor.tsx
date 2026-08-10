import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { PlusCircle, Trash2, GripVertical } from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import type { ColorSet, ColorSetFieldRef } from "@/declarations";
import { HexColorPicker } from "react-colorful";

interface AdvancedColorSetEditorProps {
  colorSet?: ColorSet
  existingColorSets: ColorSet[]
  onSave: (colorSet: Omit<ColorSet, "id">) => void
}

interface ColorSetValue {
  id: string
  name: string
  value: string
}

interface ColorSetField {
  id: string
  name: string
  type: string
}

/**
 * Generate a color that is maximally distinct from a set of existing colors.
 * Uses HSL color space: picks the hue that maximizes the minimum angular
 * distance from all existing hues, with fixed saturation and lightness.
 */
function generateDistinctColor(existingColorSets: ColorSet[]): string {
  const existingColors = existingColorSets
    .map((cs) => cs.color)
    .filter((c): c is string => !!c)

  if (existingColors.length === 0) {
    return "hsl(210, 70%, 55%)" // Start with blue if nothing exists
  }

  // Parse hex colors to HSL hue values (0-360)
  function hexToHue(hex: string): number {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
    if (!result) return 0
    const r = parseInt(result[1], 16) / 255
    const g = parseInt(result[2], 16) / 255
    const b = parseInt(result[3], 16) / 255
    const max = Math.max(r, g, b), min = Math.min(r, g, b)
    let h = 0
    if (max !== min) {
      const d = max - min
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60
      else if (max === g) h = ((b - r) / d + 2) * 60
      else h = ((r - g) / d + 4) * 60
    }
    return h
  }

  // Also handle hsl(...) strings
  function parseHue(color: string): number {
    const hslMatch = color.match(/hsl\(\s*([\d.]+)/)
    if (hslMatch) return parseFloat(hslMatch[1])
    return hexToHue(color)
  }

  const existingHues = existingColors.map(parseHue)

  // Test candidate hues in 1-degree steps, find the one with max min-distance
  let bestHue = 0
  let bestMinDist = -1
  for (let candidate = 0; candidate < 360; candidate++) {
    let minDist = 360
    for (const h of existingHues) {
      const diff = Math.abs(candidate - h)
      const dist = Math.min(diff, 360 - diff)
      if (dist < minDist) minDist = dist
    }
    if (minDist > bestMinDist) {
      bestMinDist = minDist
      bestHue = candidate
    }
  }

  return `hsl(${bestHue}, 70%, 55%)`
}

export function AdvancedColorSetEditor({ colorSet, existingColorSets, onSave }: AdvancedColorSetEditorProps) {
  const defaultColor = colorSet?.color || generateDistinctColor(existingColorSets)
  const [name, setName] = useState(colorSet?.name || "")
  const [type, setType] = useState(colorSet?.type || "basic")
  const [definition, setDefinition] = useState(colorSet?.definition || "")
  const [color, setColor] = useState(defaultColor)
  const [timed, setTimed] = useState(colorSet?.timed || false) // Whether this is a timed color set
  const [activeTab, setActiveTab] = useState("visual")

  // For basic color sets
  const [basicType, setBasicType] = useState("int")
  const [withRange, setWithRange] = useState(false)
  const [rangeStart, setRangeStart] = useState("1")
  const [rangeEnd, setRangeEnd] = useState("100")

  // For enumerated color sets
  const [enumValues, setEnumValues] = useState<ColorSetValue[]>([{ id: uuidv4(), name: "value1", value: "1" }])

  // For list color sets
  const [baseColorSet, setBaseColorSet] = useState("INT")

  // For product color sets
  const [productColorSets, setProductColorSets] = useState<string[]>([])

  // For record color sets
  const [recordFields, setRecordFields] = useState<ColorSetField[]>([{ id: uuidv4(), name: "field1", type: "INT" }])
  // Object references carried by record fields (keyed by field id), for OCEL o2o export
  const [fieldRefs, setFieldRefs] = useState<Record<string, { target: string; qualifier: string; eventQualifier: string; reverse: boolean }>>({})

  // For subset color sets
  const [subsetOf, setSubsetOf] = useState("INT")
  const [predicate, setPredicate] = useState("")

  /* eslint-disable react-hooks/set-state-in-effect -- Form init from prop; component should be keyed by colorSet.id */
  useEffect(() => {
    if (colorSet) {
      setName(colorSet.name);
      setType(colorSet.type);
      setDefinition(colorSet.definition);
      // Set timed from the timed property, or detect from definition string as fallback
      const timedFromDef = /\btimed\b/.test(colorSet.definition.replace(/colset\s+\w+\s*=/, ''));
      setTimed(colorSet.timed || timedFromDef);

      // Try to parse the definition based on type
      if (colorSet.type === "basic") {
        const withMatch = colorSet.definition.match(/colset\s+\w+\s*=\s*(\w+)(?:\s+with\s+(\d+)\.\.(\d+))?/);
        if (withMatch) {
          setBasicType(withMatch[1]);
          if (withMatch[2] && withMatch[3]) {
            setWithRange(true);
            setRangeStart(withMatch[2]);
            setRangeEnd(withMatch[3]);
          }
        }
      } else if (colorSet.type === "list") {
        const listMatch = colorSet.definition.match(/list\s+(\w+)/);
        if (listMatch) {
          const baseSetName = listMatch[1];
          const baseSet = existingColorSets.find((cs) => cs.name === baseSetName);
          if (baseSet) {
            setBaseColorSet(baseSet.name);
          }
        }
      } else if (colorSet.type === "product") {
        const productMatch = colorSet.definition.match(/product\s+([\w\s\*]+)/);
        if (productMatch) {
          // Strip trailing "timed" suffix(es) to avoid them being parsed as a component
          const componentsStr = productMatch[1].replace(/(\s+timed)+\s*$/, '').trim();
          const productSets = componentsStr
            ? componentsStr.split("*").map((cs) => cs.trim()).filter(Boolean)
            : [];
          setProductColorSets(productSets);
        }
      } else if (colorSet.type === "record") {
        const recordMatch = colorSet.definition.match(/record\s+([\w\s\:\*]+)/);
        if (recordMatch) {
          // Strip trailing "timed" suffix(es) to avoid them being parsed as part of the last field's type
          const fieldsStr = recordMatch[1].replace(/(\s+timed)+\s*$/, '').trim();
          const fields = fieldsStr
            .split("*")
            .map((field) => {
              const [name, type] = field.split(":").map((s) => s.trim());
              return { id: uuidv4(), name, type };
            });
          setRecordFields(fields);
          // Rehydrate reference annotations, matching stored refs to fields by name
          const refs: Record<string, { target: string; qualifier: string; eventQualifier: string; reverse: boolean }> = {};
          for (const ref of colorSet.refs ?? []) {
            const field = fields.find((f) => f.name === ref.field);
            if (field) {
              refs[field.id] = {
                target: ref.target,
                qualifier: ref.qualifier ?? "",
                eventQualifier: ref.eventQualifier ?? "",
                reverse: ref.reverse ?? false,
              };
            }
          }
          setFieldRefs(refs);
        }
      } else if (colorSet.type === "enum") {
        const enumMatch = colorSet.definition.match(/with\s+(.+?)(?:\s+timed)?\s*;?\s*$/);
        if (enumMatch) {
          const values = enumMatch[1].split('|').map((v, i) => ({
            id: uuidv4(),
            name: v.trim(),
            value: `${i + 1}`,
          }));
          setEnumValues(values);
        }
      } else if (colorSet.type === "subset") {
        const subsetMatch = colorSet.definition.match(/subset\s+(\w+)\s+by\s+(.+)/);
        if (subsetMatch) {
          setSubsetOf(subsetMatch[1]);
          setPredicate(subsetMatch[2]);
        }
      }
    }
  }, [colorSet, existingColorSets]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleAddEnumValue = () => {
    setEnumValues([
      ...enumValues,
      { id: uuidv4(), name: `value${enumValues.length + 1}`, value: `${enumValues.length + 1}` },
    ])
  }

  const handleRemoveEnumValue = (id: string) => {
    setEnumValues(enumValues.filter((v) => v.id !== id))
  }

  const handleUpdateEnumValue = (id: string, field: "name" | "value", value: string) => {
    setEnumValues(enumValues.map((v) => (v.id === id ? { ...v, [field]: value } : v)))
  }

  const handleAddProductColorSet = (colorSetName: string) => {
    if (colorSetName && !productColorSets.includes(colorSetName)) {
      setProductColorSets([...productColorSets, colorSetName])
    }
  }

  const handleRemoveProductColorSet = (index: number) => {
    setProductColorSets(productColorSets.filter((_, i) => i !== index))
  }

  // Drag-to-reorder state for product color sets
  const [dragIndex, setDragIndex] = useState<number | null>(null)

  const handleProductDragStart = (e: React.DragEvent, index: number) => {
    setDragIndex(index)
    e.dataTransfer.effectAllowed = "move"
  }

  const handleProductDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"
  }

  const handleProductDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault()
    if (dragIndex === null || dragIndex === targetIndex) return
    const updated = [...productColorSets]
    const [moved] = updated.splice(dragIndex, 1)
    updated.splice(targetIndex, 0, moved)
    setProductColorSets(updated)
    setDragIndex(null)
  }

  const handleProductDragEnd = () => {
    setDragIndex(null)
  }

  const handleAddRecordField = () => {
    setRecordFields([...recordFields, { id: uuidv4(), name: `field${recordFields.length + 1}`, type: "INT" }])
  }

  const removeFieldRef = (fieldId: string) => {
    setFieldRefs((prev) => {
      const rest = { ...prev }
      delete rest[fieldId]
      return rest
    })
  }

  const handleRemoveRecordField = (id: string) => {
    setRecordFields(recordFields.filter((f) => f.id !== id))
    removeFieldRef(id)
  }

  const handleUpdateRecordField = (id: string, field: "name" | "type", value: string) => {
    setRecordFields(recordFields.map((f) => (f.id === id ? { ...f, [field]: value } : f)))
  }

  const handleUpdateFieldRef = (fieldId: string, target: string) => {
    if (target === "__none__") {
      removeFieldRef(fieldId)
    } else {
      setFieldRefs((prev) => ({
        ...prev,
        [fieldId]: { target, qualifier: prev[fieldId]?.qualifier ?? "", eventQualifier: prev[fieldId]?.eventQualifier ?? "", reverse: prev[fieldId]?.reverse ?? false },
      }))
    }
  }

  const generateDefinition = (): string => {
    let def = `colset ${name} = `

    switch (type) {
      case "basic":
        def += basicType
        if (withRange) {
          def += ` with ${rangeStart}..${rangeEnd}`
        }
        break

      case "enum":
        def += `with ${enumValues.map((v) => v.name).join(" | ")}`
        break

      case "list":
        def += `list ${baseColorSet}`
        break

      case "product":
        def += `product ${productColorSets.join(" * ")}`
        break

      case "record":
        def += `record ${recordFields.map((f) => `${f.name}: ${f.type}`).join(" * ")}`
        break

      case "subset":
        def += `subset ${subsetOf} by ${predicate}`
        break

      default:
        def += type
    }

    // Append "timed" suffix if this is a timed color set
    if (timed) {
      def += " timed"
    }

    def += ";"
    return def
  }

  const handleSave = () => {
    // In visual mode, always regenerate definition to reflect current field values (name, type, etc.)
    // In text mode, use the raw definition text the user typed
    const finalDefinition = activeTab === "text" ? definition : generateDefinition()

    // Collect reference annotations for record fields (drives OCEL o2o export)
    const refs: ColorSetFieldRef[] =
      type === "record"
        ? recordFields
            .filter((f) => fieldRefs[f.id]?.target)
            .map((f) => {
              const ref = fieldRefs[f.id]
              return {
                field: f.name,
                target: ref.target,
                ...(ref.qualifier.trim() ? { qualifier: ref.qualifier.trim() } : {}),
                ...(ref.eventQualifier.trim() ? { eventQualifier: ref.eventQualifier.trim() } : {}),
                ...(ref.reverse ? { reverse: true } : {}),
              }
            })
        : []

    onSave({
      name,
      type,
      definition: finalDefinition,
      color, // Include the color
      timed, // Include the timed flag
      refs, // Field-level object references (empty array clears previous annotations)
    })
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>
          <Input id="name" placeholder="e.g., DATA" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="type">Type</Label>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger id="type">
              <SelectValue placeholder="Select type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="basic">Basic</SelectItem>
              <SelectItem value="enum">Enumerated</SelectItem>
              <SelectItem value="list">List</SelectItem>
              <SelectItem value="product">Product</SelectItem>
              <SelectItem value="record">Record</SelectItem>
              <SelectItem value="subset">Subset</SelectItem>
              <SelectItem value="union">Union</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="color">Color</Label>
        <div className="flex flex-col items-center space-y-2">
          <HexColorPicker color={color} onChange={setColor} />
          <Input
            id="color"
            type="text"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="w-full mt-2"
          />
        </div>
      </div>

      <div className="flex items-center space-x-2">
        <Checkbox
          id="timed"
          checked={timed}
          onCheckedChange={(checked) => setTimed(checked === true)}
        />
        <Label htmlFor="timed" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
          Timed color set
        </Label>
        <span className="text-xs text-muted-foreground">
          (tokens carry timestamps for timed simulations)
        </span>
      </div>

      <Tabs defaultValue="visual" className="w-full" onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="visual">Visual Editor</TabsTrigger>
          <TabsTrigger value="text">Text Editor</TabsTrigger>
        </TabsList>

        <TabsContent value="visual" className="space-y-4 pt-4">
          {type === "basic" && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Basic Type</Label>
                <Select value={basicType} onValueChange={(val) => {
                  setBasicType(val);
                  if (val !== 'int' && val !== 'intinf') {
                    setWithRange(false);
                  }
                }}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="int">Integer</SelectItem>
                    <SelectItem value="bool">Boolean</SelectItem>
                    <SelectItem value="string">String</SelectItem>
                    <SelectItem value="unit">Unit</SelectItem>
                    <SelectItem value="real">Real</SelectItem>
                    <SelectItem value="time">Time</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {(basicType === 'int' || basicType === 'intinf') && (
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="withRange"
                  checked={withRange}
                  onChange={(e) => setWithRange(e.target.checked)}
                  className="rounded border-gray-300"
                />
                <Label htmlFor="withRange">With Range</Label>
              </div>
              )}

              {withRange && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="rangeStart">Range Start</Label>
                    <Input
                      id="rangeStart"
                      type="number"
                      value={rangeStart}
                      onChange={(e) => setRangeStart(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="rangeEnd">Range End</Label>
                    <Input id="rangeEnd" type="number" value={rangeEnd} onChange={(e) => setRangeEnd(e.target.value)} />
                  </div>
                </div>
              )}
            </div>
          )}

          {type === "enum" && (
            <div className="space-y-4">
              <Label>Enumerated Values</Label>

              {enumValues.map((value) => (
                <div key={value.id} className="flex items-center space-x-2">
                  <Input
                    placeholder="Value name"
                    value={value.name}
                    onChange={(e) => handleUpdateEnumValue(value.id, "name", e.target.value)}
                    className="flex-1"
                  />
                  <Button variant="ghost" size="icon" onClick={() => handleRemoveEnumValue(value.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}

              <Button variant="outline" size="sm" onClick={handleAddEnumValue} className="mt-2">
                <PlusCircle className="h-4 w-4 mr-2" />
                Add Value
              </Button>
            </div>
          )}

          {type === "list" && (
            <div className="space-y-2">
              <Label>Base Color Set</Label>
              <Select value={baseColorSet || "INT"} onValueChange={setBaseColorSet}>
                <SelectTrigger>
                  <SelectValue placeholder="Select base color set" />
                </SelectTrigger>
                <SelectContent>
                  {existingColorSets.map((cs) => (
                    <SelectItem key={cs.id} value={cs.name}>
                      {cs.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {type === "product" && (
            <div className="space-y-4">
              <Label>Product Color Sets</Label>

              {productColorSets.map((cs, index) => (
                <div
                  key={index}
                  className="flex items-center space-x-2"
                  draggable
                  onDragStart={(e) => handleProductDragStart(e, index)}
                  onDragOver={handleProductDragOver}
                  onDrop={(e) => handleProductDrop(e, index)}
                  onDragEnd={handleProductDragEnd}
                >
                  <div className="cursor-grab active:cursor-grabbing">
                    <GripVertical className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 border rounded-md px-3 py-2">{cs}</div>
                  <Button variant="ghost" size="icon" onClick={() => handleRemoveProductColorSet(index)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}

              <div className="flex items-center space-x-2">
                <Select defaultValue="INT" onValueChange={handleAddProductColorSet}>
                  <SelectTrigger>
                    <SelectValue placeholder="Add color set" />
                  </SelectTrigger>
                  <SelectContent>
                    {existingColorSets
                      .filter((cs) => cs.name !== name)
                      .map((cs) => (
                        <SelectItem key={cs.id} value={cs.name}>
                          {cs.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {type === "record" && (
            <div className="space-y-4">
              <Label>Record Fields</Label>

              {recordFields.map((field) => (
                <div key={field.id} className="space-y-1">
                  <div className="flex items-center space-x-2">
                    <Input
                      placeholder="Field name"
                      value={field.name}
                      onChange={(e) => handleUpdateRecordField(field.id, "name", e.target.value)}
                      className="flex-1"
                    />
                    <Select
                      value={field.type}
                      onValueChange={(value) => handleUpdateRecordField(field.id, "type", value)}
                    >
                      <SelectTrigger className="w-35">
                        <SelectValue placeholder="Type" />
                      </SelectTrigger>
                      <SelectContent>
                        {existingColorSets.map((cs) => (
                          <SelectItem key={cs.id} value={cs.name}>
                            {cs.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={fieldRefs[field.id]?.target ?? "__none__"}
                      onValueChange={(value) => handleUpdateFieldRef(field.id, value)}
                    >
                      <SelectTrigger className="w-37.5" title="Object type this field references (exported as an OCEL object-to-object relationship)">
                        <SelectValue placeholder="References" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">No reference</SelectItem>
                        {existingColorSets
                          .filter((cs) => cs.type === "record")
                          .map((cs) => (
                            <SelectItem key={cs.id} value={cs.name}>
                              → {cs.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <Button variant="ghost" size="icon" onClick={() => handleRemoveRecordField(field.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  {fieldRefs[field.id] && (
                    <div className="flex items-center space-x-2 pl-4">
                      <Input
                        placeholder={`o2o qualifier (default: "${field.name}")`}
                        title="Qualifier for the object-to-object relationship derived from this field"
                        value={fieldRefs[field.id].qualifier}
                        onChange={(e) =>
                          setFieldRefs((prev) => ({
                            ...prev,
                            [field.id]: { ...prev[field.id], qualifier: e.target.value },
                          }))
                        }
                        className="flex-1 h-8 text-sm"
                      />
                      <Input
                        placeholder="e2o qualifier (same)"
                        title="Role objects reached through this field play in events touching this token; defaults to the o2o qualifier"
                        value={fieldRefs[field.id].eventQualifier}
                        onChange={(e) =>
                          setFieldRefs((prev) => ({
                            ...prev,
                            [field.id]: { ...prev[field.id], eventQualifier: e.target.value },
                          }))
                        }
                        className="flex-1 h-8 text-sm"
                      />
                      <div className="flex items-center gap-1.5">
                        <Checkbox
                          id={`ref-reverse-${field.id}`}
                          checked={fieldRefs[field.id].reverse}
                          onCheckedChange={(checked) =>
                            setFieldRefs((prev) => ({
                              ...prev,
                              [field.id]: { ...prev[field.id], reverse: checked === true },
                            }))
                          }
                        />
                        <Label
                          htmlFor={`ref-reverse-${field.id}`}
                          className="text-xs text-muted-foreground"
                          title={`Emit the relationship as ${fieldRefs[field.id].target} → ${name || "this"} instead of ${name || "this"} → ${fieldRefs[field.id].target} (e.g. customer "places" order)`}
                        >
                          reverse direction
                        </Label>
                      </div>
                    </div>
                  )}
                </div>
              ))}

              <Button variant="outline" size="sm" onClick={handleAddRecordField} className="mt-2">
                <PlusCircle className="h-4 w-4 mr-2" />
                Add Field
              </Button>
            </div>
          )}

          {type === "subset" && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Subset of</Label>
                <Select value={subsetOf || "INT"} onValueChange={setSubsetOf}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select parent color set" />
                  </SelectTrigger>
                  <SelectContent>
                    {existingColorSets.map((cs) => (
                      <SelectItem key={cs.id} value={cs.name}>
                        {cs.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="predicate">Predicate</Label>
                <Input
                  id="predicate"
                  placeholder="e.g., x => x > 0"
                  value={predicate}
                  onChange={(e) => setPredicate(e.target.value)}
                />
              </div>
            </div>
          )}

          <div className="pt-4">
            <Label>Preview</Label>
            <div className="font-mono text-sm mt-2 p-3 bg-muted rounded-md">{generateDefinition()}</div>
          </div>
        </TabsContent>

        <TabsContent value="text" className="pt-4">
          <div className="space-y-2">
            <Label htmlFor="definition">Color Set Definition</Label>
            <Textarea
              id="definition"
              placeholder="colset DATA = int with 1..100;"
              className="font-mono h-[200px]"
              value={definition}
              onChange={(e) => setDefinition(e.target.value)}
            />
          </div>
        </TabsContent>
      </Tabs>

      <div className="pt-4">
        <Button
          onClick={handleSave}
          className="w-full"
          disabled={type === "product" && productColorSets.length < 2}
        >
          Save Color Set
        </Button>
      </div>
    </div>
  )
}

