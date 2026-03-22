import type { PetriNet, FusionSet, Monitor } from '@/types';
import type { ColorSet, Variable, Priority, Function, Use, Value } from '@/declarations';

import { v4 as uuidv4 } from 'uuid';
import { PlaceNodeProps } from '@/nodes/PlaceNode';
import { TransitionNodeProps } from '@/nodes/TransitionNode';

export type PetriNetData = {
  ocpnName?: string; // Top-level OCPN project name
  petriNetsById: Record<string, PetriNet>;
  petriNetOrder: string[];
  colorSets: ColorSet[]
  variables: Variable[]
  priorities: Priority[]
  functions: Function[]
  uses: Use[] // Added uses
  values: Value[] // Named constants (val declarations)
  fusionSets?: FusionSet[] // Fusion sets for fusion places
  monitors?: Monitor[] // Analysis monitors
  // Simulation settings (optional for backward compatibility)
  simulationSettings?: {
    stepsPerRun?: number;
    animationDelayMs?: number;
    simulationEpoch?: string | null;
  }
  /** Warnings generated during CPN Tools XML import (SML expressions that could not be translated, etc.) */
  importWarnings?: string[];
}

// Convert Petri Net data to CPN Tools XML format
export function convertToCPNToolsXML(data: PetriNetData): string {
  const pagesXML = Object.values(data.petriNetsById)
    .map((petriNet) => {
      const placesXML = petriNet.nodes
        .filter((node) => node.type === "place")
        .map((place) => {
          return `<place id="${place.id}">
            <posattr x="${place.position.x}" y="${place.position.y}"/>
            <fillattr colour="White" pattern="" filled="false"/>
            <lineattr colour="Black" thick="1" type="Solid"/>
            <textattr colour="Black" bold="false"/>
            <text>${place.data.label}</text>
            <ellipse w="60.000000" h="40.000000"/>
            <type id="${place.data.colorSet}">
              <text>${place.data.colorSet}</text>
            </type>
            <initmark id="${place.id}_initmark">
              <text>${place.data.initialMarking || ""}</text>
            </initmark>
          </place>`;
        })
        .join("\n");

      const transitionsXML = petriNet.nodes
        .filter((node) => node.type === "transition")
        .map((transition) => {
          return `<trans id="${transition.id}">
            <posattr x="${transition.position.x}" y="${transition.position.y}"/>
            <fillattr colour="White" pattern="" filled="false"/>
            <lineattr colour="Black" thick="1" type="solid"/>
            <textattr colour="Black" bold="false"/>
            <text>${transition.data.label}</text>
            <box w="60.000000" h="40.000000"/>
            ${
              transition.data.guard
                ? `<cond id="${transition.id}_guard">
                  <text>${transition.data.guard}</text>
                </cond>`
                : ""
            }
            ${
              transition.data.time
                ? `<time id="${transition.id}_time">
                  <text>${transition.data.time}</text>
                </time>`
                : ""
            }
            ${
              transition.data.priority
                ? `<priority id="${transition.id}_priority">
                  <text>${transition.data.priority}</text>
                </priority>`
                : ""
            }
          </trans>`;
        })
        .join("\n");

      const arcsXML = petriNet.edges
        .map((edge) => {
          return `<arc id="${edge.id}" orientation="PtoT">
            <posattr x="0.000000" y="0.000000"/>
            <fillattr colour="White" pattern="" filled="false"/>
            <lineattr colour="Black" thick="1" type="Solid"/>
            <textattr colour="Black" bold="false"/>
            <arrowattr headsize="1.200000" currentcyckle="2"/>
            <transend idref="${edge.target}"/>
            <placeend idref="${edge.source}"/>
            <annot id="${edge.id}_inscription">
              <text>${edge.label || ""}</text>
            </annot>
          </arc>`;
        })
        .join("\n");

      return `<page id="${petriNet.id}">
        <pageattr name="${petriNet.name}"/>
        ${placesXML}
        ${transitionsXML}
        ${arcsXML}
        <constraints/>
      </page>`;
    })
    .join("\n");

  const usesXML = data.uses
    .map((use) => `<use file=\"${use.name}\"/>`)
    .join('\n');

  const functionsXML = data.functions
    .map(
      (f) => `<ml id="${f.id}">
        ${f.code}
        <layout>${f.code}</layout>
      </ml>`
    )
    .join("\n        ");

  const xml = `<?xml version="1.0" encoding="iso-8859-1"?>
<!DOCTYPE workspaceElements PUBLIC "-//CPN//DTD CPNXML 1.0//EN" "http://cpntools.org/DTD/6/cpn.dtd">
<workspaceElements>
  <generator tool="CPN Tools" version="4.0.1" format="6"/>
  <cpnet>
    <globbox>
      ${usesXML}
      <block id="ID2">
        <id>Standard priorities</id>
        ${data.priorities
          .map(
            (p) => `<ml id="${p.id}">
          val ${p.name} = ${p.level};
          <layout>val ${p.name} = ${p.level};</layout>
        </ml>`
          )
          .join("\n        ")}
      </block>
      <block id="ID1">
        <id>Standard declarations</id>
        ${data.colorSets
          .map((cs) => {
            const basicTypes = ["int", "unit", "bool", "intinf", "time", "real", "string"];
            const basicTypeMatch = cs.definition.match(/colset\s+\w+\s*=\s*(\w+);$/);
            const basicType = basicTypeMatch ? basicTypeMatch[1].toLowerCase() : null;
            return `<color id="${cs.id}">
              <id>${cs.name}</id>
              ${basicType && basicTypes.includes(basicType) ? `<${basicType}/>` : ""}
              <layout>${cs.definition}</layout>
            </color>`;
          })
          .join("\n        ")}
        ${data.variables
          .map(
            (v) => `<var id="${v.id}">
          <type>
            <id>${v.colorSet}</id>
          </type>
          <id>${v.name}</id>
          <layout>var ${v.name}:${v.colorSet};</layout>
        </var>`
          )
          .join("\n        ")}
        ${functionsXML}
      </block>
    </globbox>
    ${pagesXML}
    <monitorblock name="Monitors"/>
  </cpnet>
</workspaceElements>`;

  return xml;
}

// Convert Petri Net data to cpn-py JSON format
export function convertToCPNPyJSON(data: PetriNetData): string {
  const allNodes = Object.values(data.petriNetsById).flatMap((petriNet) => petriNet.nodes);
  const allEdges = Object.values(data.petriNetsById).flatMap((petriNet) => petriNet.edges);

  const json = {
    $schema: "http://json-schema.org/draft-07/schema#",
    colorSets: data.colorSets.map((cs) => cs.definition),
    places: allNodes
      .filter((node) => node.type === "place")
      .map((place) => ({
        name: place.data.label,
        colorSet: place.data.colorSet,
      })),
    transitions: allNodes
      .filter((node) => node.type === "transition")
      .map((transition) => ({
        name: transition.data.label,
        variables: transition.data.variables || [],
        guard: transition.data.guard || "True",
        inArcs: allEdges
          .filter((edge) => edge.target === transition.id)
          .map((edge) => ({
            place: allNodes.find((node) => node.id === edge.source)?.data.label || "",
            expression: edge.label || "",
          })),
        outArcs: allEdges
          .filter((edge) => edge.source === transition.id)
          .map((edge) => ({
            place: allNodes.find((node) => node.id === edge.target)?.data.label || "",
            expression: edge.label || "",
          })),
      })),
    initialMarking: allNodes
      .filter((node) => node.type === "place")
      .reduce((acc: Record<string, { tokens: (string | number)[][] }>, place) => {
        const marking = place.data.initialMarking || [];
        acc[String(place.data.label)] = marking && Array.isArray(marking)
          ? { tokens: marking.map((token: string | number | (string | number)[]) =>
              Array.isArray(token)
                ? token.map((t) => (typeof t === "string" ? t : Number(t)))
                : [typeof token === "string" ? token : Number(token)]
            ) }
          : { tokens: [] };
        return acc;
      }, {} as Record<string, { tokens: (string | number)[][] }>),
    evaluationContext: null,
  };

  return JSON.stringify(json, null, 2);
}

// Convert Petri Net data to JSON format
export function convertToJSON(data: PetriNetData): string {
  const transformedData = {
    ocpnName: data.ocpnName || undefined,
    petriNets: data.petriNetOrder.map((id) => {
      const petriNet = data.petriNetsById[id];
      return {
        id: petriNet.id,
        name: petriNet.name,
        places: petriNet.nodes
          .filter((node) => node.type === "place")
          .map((place) => ({
            id: place.id,
            name: place.data.label, // Use "name" instead of "label"
            colorSet: place.data.colorSet,
            initialMarking: place.data.initialMarking || "",
            marking: place.data.marking || "",
            position: place.position,
            size: place.measured || { width: 50, height: 30 }, // Replace "measured" with "size"
            colorSetOffset: place.data.colorSetOffset || undefined,
            tokenCountOffset: place.data.tokenCountOffset || undefined,
            markingOffset: place.data.markingOffset || undefined,
            portType: place.data.portType || undefined,
            fusionSetId: place.data.fusionSetId || undefined,
          })),
        transitions: petriNet.nodes
          .filter((node) => node.type === "transition")
          .map((transition) => ({
            id: transition.id,
            name: transition.data.label, // Use "name" instead of "label"
            guard: transition.data.guard || "",
            time: transition.data.time || "",
            priority: transition.data.priority || "",
            codeSegment: transition.data.codeSegment || "",
            position: transition.position,
            size: transition.measured || { width: 50, height: 30 }, // Replace "measured" with "size"
            subPageId: transition.data.subPageId || undefined,
            socketAssignments: transition.data.socketAssignments || undefined,
          })),
        arcs: petriNet.edges.map((arc) => ({
          id: arc.id,
          source: arc.source,
          target: arc.target,
          inscription: arc.label || "", // Use "inscription" instead of "label"
          delay: (arc.data as Record<string, unknown>)?.delay || "", // Per-arc time delay expression
          isBidirectional: arc.data?.isBidirectional || false, // Include bidirectional flag
          arcType: arc.data?.arcType || undefined, // Include arc type if not normal
          labelOffset: arc.data?.labelOffset || undefined, // Include label offset if set
          bendpoints: arc.data?.bendpoints || undefined, // Include bendpoints if set
        })),
      };
    }),
    colorSets: data.colorSets,
    variables: data.variables,
    priorities: data.priorities,
    functions: data.functions,
    uses: data.uses, // Include uses in JSON
    values: data.values, // Include values in JSON
    fusionSets: data.fusionSets || undefined, // Include fusion sets
    monitors: data.monitors?.length ? data.monitors : undefined, // Include monitors
    simulationSettings: data.simulationSettings || undefined, // Include simulation settings if present
    simulationEpoch: data.simulationSettings?.simulationEpoch || undefined, // Top-level for WASM simulator
  };

  return JSON.stringify(transformedData, null, 2);
}

// Parse JSON data back into PetriNetData format
export function parseJSON(content: string): PetriNetData {
  const parsedData = JSON.parse(content);

  // Basic validation (can be expanded)
  if (!parsedData || !Array.isArray(parsedData.petriNets)) {
    throw new Error("Invalid JSON format: Missing 'petriNets' array.");
  }

  const petriNetsById: Record<string, PetriNet> = {};
  const petriNetOrder: string[] = [];

  parsedData.petriNets.forEach((petriNet: {
    id: string;
    name: string;
    places: {
      id: string;
      name: string;
      colorSet: string;
      initialMarking?: string;
      marking?: string;
      position?: { x: number; y: number };
      size?: { width: number; height: number };
      colorSetOffset?: { x: number; y: number };
      tokenCountOffset?: { x: number; y: number };
      markingOffset?: { x: number; y: number };
      portType?: 'in' | 'out' | 'io';
      fusionSetId?: string;
    }[];
    transitions: {
      id: string;
      name: string;
      guard?: string;
      time?: string;
      priority?: string;
      codeSegment?: string;
      position?: { x: number; y: number };
      size?: { width: number; height: number };
      subPageId?: string;
      socketAssignments?: { portPlaceId: string; socketPlaceId: string }[];
    }[];
    arcs: {
      id: string;
      source: string;
      target: string;
      inscription?: string;
      delay?: string;
      isBidirectional?: boolean;
      arcType?: string;
      labelOffset?: { x: number; y: number };
      bendpoints?: { x: number; y: number }[];
    }[];
  }) => {
    const places = petriNet.places.map((place) => ({
      id: place.id,
      type: 'place',
      position: place.position || { x: 0, y: 0 }, // Provide default position if missing
      data: {
        label: place.name, // Map 'name' back to 'label'
        colorSet: place.colorSet,
        initialMarking: place.initialMarking || "",
        marking: place.marking || "",
        colorSetOffset: place.colorSetOffset || undefined,
        tokenCountOffset: place.tokenCountOffset || undefined,
        markingOffset: place.markingOffset || undefined,
        portType: place.portType || undefined,
        fusionSetId: place.fusionSetId || undefined,
      },
      width: place.size?.width || 50,
      height: place.size?.height || 30,
    }));

    const transitions = petriNet.transitions.map((transition) => ({
      id: transition.id,
      type: 'transition',
      position: transition.position || { x: 0, y: 0 }, // Provide default position if missing
      data: {
        label: transition.name, // Map 'name' back to 'label'
        guard: transition.guard || "",
        time: transition.time || "",
        priority: transition.priority || "",
        codeSegment: transition.codeSegment || "",
        subPageId: transition.subPageId || undefined,
        socketAssignments: transition.socketAssignments || undefined,
      },
      width: transition.size?.width || 50,
      height: transition.size?.height || 30,
    }));

    const arcs = petriNet.arcs.map((arc) => ({
      id: arc.id,
      source: arc.source,
      target: arc.target,
      label: arc.inscription || "", // Map 'inscription' back to 'label'
      data: {
        isBidirectional: arc.isBidirectional || false,
        arcType: arc.arcType || undefined,
        delay: arc.delay || "",
        labelOffset: arc.labelOffset || undefined,
        bendpoints: arc.bendpoints || undefined,
      },
    }));

    const net: PetriNet = {
      id: petriNet.id,
      name: petriNet.name,
      nodes: [...places, ...transitions],
      edges: arcs,
      selectedElement: null, // Default selectedElement
    };

    petriNetsById[petriNet.id] = net;
    petriNetOrder.push(petriNet.id);
  });

  const colorSets: ColorSet[] = parsedData.colorSets || [];
  const variables: Variable[] = parsedData.variables || [];
  const priorities: Priority[] = parsedData.priorities || [];
  const functions: Function[] = parsedData.functions || [];
  const uses: Use[] = parsedData.uses || []; // Parse uses
  const values: Value[] = parsedData.values || []; // Parse values
  const fusionSets: FusionSet[] = parsedData.fusionSets || []; // Parse fusion sets
  const monitors: Monitor[] = parsedData.monitors || []; // Parse monitors
  
  // Parse simulation settings if present
  const simulationSettings = parsedData.simulationSettings ? {
    stepsPerRun: parsedData.simulationSettings.stepsPerRun,
    animationDelayMs: parsedData.simulationSettings.animationDelayMs,
    simulationEpoch: parsedData.simulationSettings.simulationEpoch,
  } : undefined;

  return {
    ocpnName: parsedData.ocpnName || undefined,
    petriNetsById,
    petriNetOrder,
    colorSets,
    variables,
    priorities,
    functions,
    uses, // Include uses in the returned data
    values, // Include values in the returned data
    fusionSets, // Include fusion sets
    monitors, // Include monitors
    simulationSettings, // Include simulation settings in the returned data
  };
}

// Save file to disk
export function saveFile(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

// ─── PNML (Petri Net Markup Language) support ─────────────────────────────

// Escape special XML characters
function escapeXML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Convert Petri Net data to PNML format (ISO/IEC 15909-2)
// Partial support: exports places, transitions, arcs with names and positions.
// Color sets, guards, and arc inscriptions are stored as toolspecific data.
export function convertToPNML(data: PetriNetData): string {
  const nets = data.petriNetOrder.map((netId) => {
    const petriNet = data.petriNetsById[netId];

    const placesXML = petriNet.nodes
      .filter((node) => node.type === 'place')
      .map((place) => {
        const pd = place.data as unknown as PlaceNodeProps['data'];
        const initialMarking = pd.initialMarking || '';
        // Try to extract a numeric initial marking for standard PNML
        const numericMarking = typeof initialMarking === 'string'
          ? (initialMarking.match(/^(\d+)$/) ? initialMarking : '')
          : '';
        return `      <place id="${escapeXML(place.id)}">
        <name><text>${escapeXML(String(pd.label || ''))}</text></name>
        <graphics>
          <position x="${Math.round(place.position.x)}" y="${Math.round(place.position.y)}"/>
        </graphics>${numericMarking ? `
        <initialMarking><text>${numericMarking}</text></initialMarking>` : ''}${pd.colorSet || initialMarking ? `
        <toolspecific tool="ocpn-tools" version="1.0">${pd.colorSet ? `
          <colorSet>${escapeXML(pd.colorSet)}</colorSet>` : ''}${initialMarking && !numericMarking ? `
          <initialMarking>${escapeXML(String(initialMarking))}</initialMarking>` : ''}${pd.portType ? `
          <portType>${pd.portType}</portType>` : ''}
        </toolspecific>` : ''}
      </place>`;
      })
      .join('\n');

    const transitionsXML = petriNet.nodes
      .filter((node) => node.type === 'transition')
      .map((transition) => {
        const td = transition.data as unknown as TransitionNodeProps['data'];
        const hasToolData = td.guard || td.time || td.priority || td.codeSegment || td.subPageId;
        return `      <transition id="${escapeXML(transition.id)}">
        <name><text>${escapeXML(String(td.label || ''))}</text></name>
        <graphics>
          <position x="${Math.round(transition.position.x)}" y="${Math.round(transition.position.y)}"/>
        </graphics>${hasToolData ? `
        <toolspecific tool="ocpn-tools" version="1.0">${td.guard ? `
          <guard>${escapeXML(td.guard)}</guard>` : ''}${td.time ? `
          <time>${escapeXML(td.time)}</time>` : ''}${td.priority ? `
          <priority>${escapeXML(td.priority)}</priority>` : ''}${td.codeSegment ? `
          <codeSegment>${escapeXML(td.codeSegment)}</codeSegment>` : ''}${td.subPageId ? `
          <subPageId>${escapeXML(td.subPageId)}</subPageId>` : ''}
        </toolspecific>` : ''}
      </transition>`;
      })
      .join('\n');

    const arcsXML = petriNet.edges
      .map((edge) => {
        const label = typeof edge.label === 'string' ? edge.label : '';
        const hasInscription = label || edge.data?.isBidirectional || edge.data?.arcType || edge.data?.delay;
        return `      <arc id="${escapeXML(edge.id)}" source="${escapeXML(edge.source)}" target="${escapeXML(edge.target)}">
        <name><text>${escapeXML(label)}</text></name>${hasInscription ? `
        <toolspecific tool="ocpn-tools" version="1.0">${edge.data?.isBidirectional ? `
          <isBidirectional>true</isBidirectional>` : ''}${edge.data?.arcType ? `
          <arcType>${escapeXML(String(edge.data.arcType))}</arcType>` : ''}${edge.data?.delay ? `
          <delay>${escapeXML(String(edge.data.delay))}</delay>` : ''}
        </toolspecific>` : ''}
      </arc>`;
      })
      .join('\n');

    return `    <page id="${escapeXML(netId)}">
      <name><text>${escapeXML(petriNet.name)}</text></name>
${placesXML}
${transitionsXML}
${arcsXML}
    </page>`;
  });

  // Store declarations as toolspecific data at the net level
  const declarationsXML = (data.colorSets.length || data.variables.length || data.priorities.length || data.functions.length) ? `
    <toolspecific tool="ocpn-tools" version="1.0">
      <declarations>${data.colorSets.map((cs) => `
        <colorSet id="${escapeXML(cs.id || '')}" name="${escapeXML(cs.name)}" type="${escapeXML(cs.type)}" color="${escapeXML(cs.color || '')}">
          <definition>${escapeXML(cs.definition)}</definition>
        </colorSet>`).join('')}${data.variables.map((v) => `
        <variable id="${escapeXML(v.id || '')}" name="${escapeXML(v.name)}" colorSet="${escapeXML(v.colorSet)}"/>`).join('')}${data.priorities.map((p) => `
        <priority id="${escapeXML(p.id || '')}" name="${escapeXML(p.name)}" level="${p.level}"/>`).join('')}${data.functions.map((f) => `
        <function id="${escapeXML(f.id || '')}" name="${escapeXML(f.name)}">
          <code>${escapeXML(f.code)}</code>
        </function>`).join('')}
      </declarations>
    </toolspecific>` : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<pnml xmlns="http://www.pnml.org/version-2009/grammar/pnml">
  <net id="${escapeXML(data.ocpnName || 'net1')}" type="http://www.pnml.org/version-2009/grammar/ptnet">
    <name><text>${escapeXML(data.ocpnName || 'Petri Net')}</text></name>${declarationsXML}
${nets.join('\n')}
  </net>
</pnml>`;
}

// Parse PNML (Petri Net Markup Language) content into PetriNetData.
// Partial support: reads places, transitions, arcs with names and positions.
// Reads ocpn-tools toolspecific extensions if present.
export function parsePNML(content: string): PetriNetData {
  const parser = new DOMParser();
  const doc = parser.parseFromString(content, 'text/xml');

  const parserError = doc.querySelector('parsererror');
  if (parserError) {
    throw new Error('Invalid PNML XML: ' + parserError.textContent);
  }

  // Helper to get text content from a child element path
  function getText(parent: Element, ...path: string[]): string {
    let el: Element | null = parent;
    for (const tag of path) {
      if (!el) return '';
      el = el.querySelector(':scope > ' + tag);
    }
    return el?.textContent?.trim() || '';
  }

  // Helper to get toolspecific element for ocpn-tools
  function getToolspecific(parent: Element): Element | null {
    const toolspecifics = parent.querySelectorAll(':scope > toolspecific');
    for (const ts of toolspecifics) {
      if (ts.getAttribute('tool') === 'ocpn-tools') return ts;
    }
    return null;
  }

  const petriNetsById: Record<string, PetriNet> = {};
  const petriNetOrder: string[] = [];
  const colorSets: ColorSet[] = [];
  const variables: Variable[] = [];
  const priorities: Priority[] = [];
  const functions: Function[] = [];

  // Track sort names discovered from place types / declarations
  const discoveredSorts = new Set<string>();

  // Find all net elements
  const nets = doc.querySelectorAll('pnml > net');
  let ocpnName = '';

  for (const net of nets) {
    ocpnName = getText(net, 'name', 'text') || net.getAttribute('id') || 'Petri Net';

    // Parse declarations from toolspecific if present (ocpn-tools round-trip)
    const netToolspecific = getToolspecific(net);
    if (netToolspecific) {
      const decls = netToolspecific.querySelector(':scope > declarations');
      if (decls) {
        for (const csEl of decls.querySelectorAll(':scope > colorSet')) {
          const csName = csEl.getAttribute('name') || '';
          colorSets.push({
            id: csEl.getAttribute('id') || uuidv4(),
            name: csName,
            type: csEl.getAttribute('type') || 'basic',
            color: csEl.getAttribute('color') || generateRandomColor(),
            definition: getText(csEl, 'definition'),
          });
          if (csName) discoveredSorts.add(csName);
        }
        for (const vEl of decls.querySelectorAll(':scope > variable')) {
          variables.push({
            id: vEl.getAttribute('id') || uuidv4(),
            name: vEl.getAttribute('name') || '',
            colorSet: vEl.getAttribute('colorSet') || '',
          });
        }
        for (const pEl of decls.querySelectorAll(':scope > priority')) {
          priorities.push({
            id: pEl.getAttribute('id') || uuidv4(),
            name: pEl.getAttribute('name') || '',
            level: parseInt(pEl.getAttribute('level') || '1000', 10),
          });
        }
        for (const fEl of decls.querySelectorAll(':scope > function')) {
          functions.push({
            id: fEl.getAttribute('id') || uuidv4(),
            name: fEl.getAttribute('name') || '',
            code: getText(fEl, 'code'),
          });
        }
      }
    }

    // Parse standard PNML declarations from <declaration> elements inside pages
    const declEls = net.querySelectorAll('declaration');
    for (const declEl of declEls) {
      const declsContainer = declEl.querySelector('structure > declarations');
      if (!declsContainer) continue;
      parsePNMLDeclarations(declsContainer, colorSets, variables, discoveredSorts);
    }

    // Parse pages (subpages)
    const pages = net.querySelectorAll(':scope > page');
    if (pages.length === 0) {
      // No pages - treat the net itself as a single page
      const netId = uuidv4();
      const { nodes, edges } = parsePNMLPage(net, getToolspecific, getText, discoveredSorts);
      petriNetsById[netId] = {
        id: netId,
        name: ocpnName,
        nodes,
        edges,
        selectedElement: null,
      };
      petriNetOrder.push(netId);
    } else {
      for (const page of pages) {
        const pageId = page.getAttribute('id') || uuidv4();
        const pageName = getText(page, 'name', 'text') || 'Page';
        // Parse declarations inside this page too
        const pageDeclEls = page.querySelectorAll(':scope > declaration');
        for (const declEl of pageDeclEls) {
          const declsContainer = declEl.querySelector('structure > declarations');
          if (declsContainer) {
            parsePNMLDeclarations(declsContainer, colorSets, variables, discoveredSorts);
          }
        }
        const { nodes, edges } = parsePNMLPage(page, getToolspecific, getText, discoveredSorts);
        petriNetsById[pageId] = {
          id: pageId,
          name: pageName,
          nodes,
          edges,
          selectedElement: null,
        };
        petriNetOrder.push(pageId);
      }
    }
  }

  // Ensure all discovered sorts have corresponding color sets
  const existingNames = new Set(colorSets.map((cs) => cs.name));
  for (const sortName of discoveredSorts) {
    if (!existingNames.has(sortName)) {
      // Map standard PNML built-in sorts to CPN definitions
      const builtinDef = pnmlBuiltinSortDefinition(sortName);
      colorSets.push({
        id: uuidv4(),
        name: sortName,
        type: builtinDef ? 'basic' : 'basic',
        definition: builtinDef || `colset ${sortName} = unit;`,
        color: generateRandomColor(),
      });
      existingNames.add(sortName);
    }
  }

  // If no nets found, create an empty one
  if (petriNetOrder.length === 0) {
    const netId = uuidv4();
    petriNetsById[netId] = {
      id: netId,
      name: 'Main',
      nodes: [],
      edges: [],
      selectedElement: null,
    };
    petriNetOrder.push(netId);
  }

  return {
    ocpnName: ocpnName || undefined,
    petriNetsById,
    petriNetOrder,
    colorSets,
    variables,
    priorities,
    functions,
    uses: [],
    values: [],
  };
}

// Map standard PNML built-in sort names to CPN-style definitions
function pnmlBuiltinSortDefinition(sortName: string): string | null {
  const upper = sortName.toUpperCase();
  const map: Record<string, string> = {
    'UNIT': 'colset UNIT = unit;',
    'DOT': 'colset DOT = unit;',
    'BOOL': 'colset BOOL = bool;',
    'BOOLEAN': 'colset BOOLEAN = bool;',
    'INT': 'colset INT = int;',
    'INTEGER': 'colset INTEGER = int;',
    'NAT': 'colset NAT = int;',       // natural numbers (approximation)
    'NATURAL': 'colset NATURAL = int;',
    'POS': 'colset POS = int;',       // positive integers (approximation)
    'POSITIVE': 'colset POSITIVE = int;',
    'STRING': 'colset STRING = string;',
    'REAL': 'colset REAL = real;',
  };
  return map[upper] || null;
}

// Parse standard PNML <declarations> structure into colorSets and variables
function parsePNMLDeclarations(
  declsContainer: Element,
  colorSets: ColorSet[],
  variables: Variable[],
  discoveredSorts: Set<string>,
) {
  const existingNames = new Set(colorSets.map((cs) => cs.name));

  // Parse sorts: <arbitrarysort>, <namedsort>
  // <arbitrarysort id="id1" name="SITE"/> — abstract/opaque sort
  for (const sortEl of declsContainer.querySelectorAll(':scope > arbitrarysort')) {
    const sortName = sortEl.getAttribute('name') || '';
    if (sortName && !existingNames.has(sortName)) {
      colorSets.push({
        id: sortEl.getAttribute('id') || uuidv4(),
        name: sortName,
        type: 'basic',
        definition: pnmlBuiltinSortDefinition(sortName) || `colset ${sortName} = unit;`,
        color: generateRandomColor(),
      });
      existingNames.add(sortName);
      discoveredSorts.add(sortName);
    }
  }

  // <namedsort id="id2" name="MESSAGE"><productsort>...</productsort></namedsort>
  // Build id-to-name map for sort resolution first
  const sortIdToName = new Map<string, string>();
  for (const cs of colorSets) {
    if (cs.id) sortIdToName.set(cs.id, cs.name);
  }
  for (const el of declsContainer.querySelectorAll(':scope > arbitrarysort, :scope > namedsort')) {
    const id = el.getAttribute('id');
    const name = el.getAttribute('name');
    if (id && name) sortIdToName.set(id, name);
  }

  for (const sortEl of declsContainer.querySelectorAll(':scope > namedsort')) {
    const sortName = sortEl.getAttribute('name') || '';
    if (sortName && !existingNames.has(sortName)) {
      // Try to build a definition from the structure
      const definition = buildSortDefinition(sortName, sortEl, sortIdToName);
      colorSets.push({
        id: sortEl.getAttribute('id') || uuidv4(),
        name: sortName,
        type: sortEl.querySelector(':scope > productsort') ? 'product' : 'basic',
        definition,
        color: generateRandomColor(),
      });
      existingNames.add(sortName);
      discoveredSorts.add(sortName);
    }
  }

  // Parse variables: <variabledecl id="id7" name="x"><usersort declaration="id1"/></variabledecl>
  const existingVarNames = new Set(variables.map((v) => v.name));
  for (const varEl of declsContainer.querySelectorAll(':scope > variabledecl')) {
    const varName = varEl.getAttribute('name') || '';
    if (varName && !existingVarNames.has(varName)) {
      const usersort = varEl.querySelector(':scope > usersort');
      const sortRef = usersort?.getAttribute('declaration') || '';
      const sortName = sortIdToName.get(sortRef) || sortRef || 'UNIT';
      variables.push({
        id: varEl.getAttribute('id') || uuidv4(),
        name: varName,
        colorSet: sortName,
      });
      existingVarNames.add(varName);
    }
  }
}

// Build a CPN-style definition from a PNML sort structure
function buildSortDefinition(sortName: string, sortEl: Element, sortIdToName: Map<string, string>): string {
  const productSort = sortEl.querySelector(':scope > productsort');
  if (productSort) {
    // Collect component sort names
    const components: string[] = [];
    for (const child of productSort.children) {
      if (child.tagName === 'usersort') {
        const ref = child.getAttribute('declaration') || '';
        components.push(sortIdToName.get(ref) || ref);
      } else if (child.tagName === 'dot') {
        components.push('UNIT');
      } else if (child.tagName === 'natural' || child.tagName === 'positive' || child.tagName === 'integer') {
        components.push('INT');
      } else if (child.tagName === 'bool') {
        components.push('BOOL');
      } else {
        components.push(child.tagName.toUpperCase());
      }
    }
    return `colset ${sortName} = product ${components.join(' * ')};`;
  }

  // Check for built-in sorts used as structure
  const struct = sortEl.querySelector(':scope > positive, :scope > natural, :scope > integer, :scope > bool, :scope > dot, :scope > string');
  if (struct) {
    const tagMap: Record<string, string> = {
      'positive': 'int', 'natural': 'int', 'integer': 'int',
      'bool': 'bool', 'dot': 'unit', 'string': 'string',
    };
    return `colset ${sortName} = ${tagMap[struct.tagName] || 'unit'};`;
  }

  return pnmlBuiltinSortDefinition(sortName) || `colset ${sortName} = unit;`;
}

// Parse places, transitions, and arcs from a PNML page/net element
function parsePNMLPage(
  pageEl: Element,
  getToolspecific: (el: Element) => Element | null,
  getText: (parent: Element, ...path: string[]) => string,
  discoveredSorts: Set<string>,
): { nodes: PetriNet['nodes']; edges: PetriNet['edges'] } {
  const nodes: PetriNet['nodes'] = [];
  const edges: PetriNet['edges'] = [];

  // Parse places
  for (const placeEl of pageEl.querySelectorAll(':scope > place')) {
    const id = placeEl.getAttribute('id') || uuidv4();
    const name = getText(placeEl, 'name', 'text');
    const graphics = placeEl.querySelector(':scope > graphics > position');
    const x = parseFloat(graphics?.getAttribute('x') || '0');
    const y = parseFloat(graphics?.getAttribute('y') || '0');

    // Standard PNML initial marking (P/T nets)
    let initialMarking = getText(placeEl, 'initialMarking', 'text');
    // High-level net initial marking
    if (!initialMarking) {
      initialMarking = getText(placeEl, 'hlinitialMarking', 'text');
    }

    // Read place type from <type><text> (high-level nets)
    let colorSet = '';
    const typeText = getText(placeEl, 'type', 'text');
    if (typeText) {
      colorSet = typeText;
      discoveredSorts.add(typeText);
    }

    let portType: string | undefined;
    // OCPN-tools extended data (for round-trip)
    const ts = getToolspecific(placeEl);
    if (ts) {
      const tsColorSet = getText(ts, 'colorSet');
      if (tsColorSet) colorSet = tsColorSet;
      const tsMarking = getText(ts, 'initialMarking');
      if (tsMarking) initialMarking = tsMarking;
      const pt = getText(ts, 'portType');
      if (pt) portType = pt;
    }

    // Default to UNIT if no type found
    if (!colorSet) {
      colorSet = 'UNIT';
      discoveredSorts.add('UNIT');
    }

    nodes.push({
      id,
      type: 'place',
      position: { x, y },
      data: {
        label: name || id,
        colorSet: colorSet || 'UNIT',
        initialMarking: initialMarking || '',
        marking: [],
        portType: portType || undefined,
      },
    });
  }

  // Parse transitions
  for (const transEl of pageEl.querySelectorAll(':scope > transition')) {
    const id = transEl.getAttribute('id') || uuidv4();
    const name = getText(transEl, 'name', 'text');
    const graphics = transEl.querySelector(':scope > graphics > position');
    const x = parseFloat(graphics?.getAttribute('x') || '0');
    const y = parseFloat(graphics?.getAttribute('y') || '0');

    let guard = '';
    let time = '';
    let priority = '';
    let codeSegment = '';
    let subPageId: string | undefined;
    const ts = getToolspecific(transEl);
    if (ts) {
      guard = getText(ts, 'guard');
      time = getText(ts, 'time');
      priority = getText(ts, 'priority');
      codeSegment = getText(ts, 'codeSegment');
      const sp = getText(ts, 'subPageId');
      if (sp) subPageId = sp;
    }

    nodes.push({
      id,
      type: 'transition',
      position: { x, y },
      data: {
        label: name || id,
        guard,
        time,
        priority,
        codeSegment,
        subPageId,
      },
    });
  }

  // Parse arcs
  for (const arcEl of pageEl.querySelectorAll(':scope > arc')) {
    const id = arcEl.getAttribute('id') || uuidv4();
    const source = arcEl.getAttribute('source') || '';
    const target = arcEl.getAttribute('target') || '';
    // Try standard PNML inscription, then high-level inscription, then arc name
    const inscription = getText(arcEl, 'inscription', 'text')
      || getText(arcEl, 'hlinscription', 'text')
      || getText(arcEl, 'name', 'text');

    let isBidirectional = false;
    let arcType: string | undefined;
    let delay = '';
    const ts = getToolspecific(arcEl);
    if (ts) {
      isBidirectional = getText(ts, 'isBidirectional') === 'true';
      const at = getText(ts, 'arcType');
      if (at) arcType = at;
      delay = getText(ts, 'delay');
    }

    edges.push({
      id,
      source,
      target,
      label: inscription,
      data: {
        isBidirectional,
        arcType,
        delay,
      },
    });
  }

  return { nodes, edges };
}

// Parse file content based on file extension
export function parseFileContent(content: string, fileName: string): PetriNetData | null {
  try {
    const extension = fileName.split(".").pop()?.toLowerCase()

    if (extension === 'ocpn') {
      // Handle OCPN Tools JSON format
      return parseJSON(content);
    } else if (extension === "json") {
      const json = parseCPNPyJSON(content);
      return json;
    } else if (extension === "xml" || extension === "cpn") {
      // This is a simplified parser - in a real implementation,
      // you would use a proper XML parser to extract the data

      // For now, we'll just check if it's CPN Tools or cpn-py format
      if (content.includes("<workspaceElements>") || content.includes("<cpnet>")) {
        // Parse CPN Tools XML
        return parseCPNToolsXML(content)
      }
    } else if (extension === "pnml") {
      return parsePNML(content);
    }

    throw new Error("Unsupported file format")
  } catch (error) {
    console.error("Error parsing file:", error)
    return null
  }
}

// Helper function to generate a random color
function generateRandomColor(): string {
  const letters = '0123456789ABCDEF';
  let color = '#';
  for (let i = 0; i < 6; i++) {
    color += letters[Math.floor(Math.random() * 16)];
  }
  return color;
}

// ─── SML-to-Rhai best-effort translation ──────────────────────────────────

/** Warnings collected during SML→Rhai translation of a CPN import. */
const importWarnings: string[] = [];

/**
 * Converts SML tuple syntax (a, b, ...) to Rhai array syntax [a, b, ...]
 * within an expression. Only converts parenthesized groups that contain
 * at least one comma at the top level (to distinguish from grouping parens).
 * Handles nested tuples, strings, and brackets.
 */
function convertSMLTuplesToRhaiArrays(expr: string): string {
  let result = '';
  let i = 0;

  while (i < expr.length) {
    if (expr[i] === '"') {
      // Skip string literals
      const start = i;
      i++;
      while (i < expr.length && expr[i] !== '"') {
        if (expr[i] === '\\') i++;
        i++;
      }
      if (i < expr.length) i++;
      result += expr.slice(start, i);
    } else if (expr[i] === '(') {
      // Found opening paren — extract the full balanced group
      const start = i;
      let depth = 0;
      let hasTopLevelComma = false;
      let j = i;

      while (j < expr.length) {
        if (expr[j] === '"') {
          j++;
          while (j < expr.length && expr[j] !== '"') {
            if (expr[j] === '\\') j++;
            j++;
          }
          if (j < expr.length) j++;
        } else if (expr[j] === '(' || expr[j] === '[' || expr[j] === '{') {
          depth++;
          j++;
        } else if (expr[j] === ')' || expr[j] === ']' || expr[j] === '}') {
          depth--;
          j++;
          if (depth === 0) break;
        } else {
          if (expr[j] === ',' && depth === 1) {
            hasTopLevelComma = true;
          }
          j++;
        }
      }

      const group = expr.slice(start, j);

      // Check if this is a function call — preceded by a word character (e.g., delay(p,r))
      // Function call arguments should NOT be converted to arrays
      const isFuncCall = start > 0 && /\w/.test(expr[start - 1]);

      if (hasTopLevelComma && !isFuncCall) {
        // It's a tuple — convert (a, b) → [a, b] and recursively convert inner tuples
        const inner = group.slice(1, -1);
        const converted = convertSMLTuplesToRhaiArrays(inner);
        result += `[${converted}]`;
      } else {
        // Function call args or grouping parens — keep as-is but recursively convert contents
        const inner = group.slice(1, -1);
        const converted = convertSMLTuplesToRhaiArrays(inner);
        result += `(${converted})`;
      }
      i = j;
    } else {
      result += expr[i];
      i++;
    }
  }

  return result;
}

/**
 * Finds the position of an SML keyword in text, skipping over string literals.
 * Returns the index of the keyword, or -1 if not found.
 */
function findSMLKeyword(text: string, keyword: string, startFrom: number): number {
  let i = startFrom;
  while (i < text.length) {
    // Skip string literals
    if (text[i] === '"') {
      i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\') i++;
        i++;
      }
      if (i < text.length) i++;
      continue;
    }
    // Check for keyword at word boundary
    if (text.slice(i, i + keyword.length) === keyword) {
      const before = i === 0 || /\W/.test(text[i - 1]);
      const after = (i + keyword.length >= text.length) || /\W/.test(text[i + keyword.length]);
      if (before && after) {
        return i;
      }
    }
    i++;
  }
  return -1;
}

/**
 * Finds the matching 'else' for an if-then-else, properly handling nesting.
 * `text` starts AFTER the 'then' keyword of the if being parsed.
 * Each nested 'if' must have its own 'else', so we count depth.
 * Returns the index in text where the matching 'else' starts, or -1.
 */
function findMatchingElse(text: string): number {
  let depth = 0;
  let i = 0;
  while (i < text.length) {
    // Skip string literals
    if (text[i] === '"') {
      i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\') i++;
        i++;
      }
      if (i < text.length) i++;
      continue;
    }
    // Check for 'if' keyword
    if (text.slice(i, i + 2) === 'if') {
      const before = i === 0 || /\W/.test(text[i - 1]);
      const after = (i + 2 >= text.length) || /\W/.test(text[i + 2]);
      if (before && after) {
        depth++;
        i += 2;
        continue;
      }
    }
    // Check for 'else' keyword
    if (text.slice(i, i + 4) === 'else') {
      const before = i === 0 || /\W/.test(text[i - 1]);
      const after = (i + 4 >= text.length) || /\W/.test(text[i + 4]);
      if (before && after) {
        if (depth === 0) {
          return i;
        }
        depth--;
        i += 4;
        continue;
      }
    }
    i++;
  }
  return -1;
}

/**
 * Translates SML if-then-else expressions to Rhai, properly handling nesting.
 * SML: if cond then e1 else e2  →  Rhai: if cond { e1 } else { e2 }
 */
function translateSMLIfThenElse(expr: string): string {
  const ifIdx = findSMLKeyword(expr, 'if', 0);
  if (ifIdx === -1) return expr;

  const prefix = expr.slice(0, ifIdx);

  const thenIdx = findSMLKeyword(expr, 'then', ifIdx + 2);
  if (thenIdx === -1) return expr;

  const condition = expr.slice(ifIdx + 2, thenIdx).trim();
  const afterThen = expr.slice(thenIdx + 4); // text after 'then'

  const elseOffset = findMatchingElse(afterThen);
  if (elseOffset === -1) return expr; // No matching else

  const thenExpr = afterThen.slice(0, elseOffset).trim();
  const elseExpr = afterThen.slice(elseOffset + 4).trim(); // text after 'else'

  // Recursively translate nested if-then-else in both branches
  const translatedThen = translateSMLIfThenElse(thenExpr);
  const translatedElse = translateSMLIfThenElse(elseExpr);

  return `${prefix}if ${condition} { ${translatedThen} } else { ${translatedElse} }`;
}

/**
 * Best-effort translation of Standard ML (CPN ML) expressions to Rhai syntax.
 * Returns the translated string, or the original if no translation rules apply.
 * Adds a warning to importWarnings if untranslatable SML syntax is detected.
 */
function translateSMLExpr(expr: string, context: string): string {
  let result = expr;

  // Track whether we made any changes
  const original = expr;

  // ── SML IntInf.toInt(expr) → expr ──
  // CPN Tools uses IntInf for arbitrary-precision integers.
  // IntInf.toInt(x) converts to standard int — in Rhai, ints are already i64.
  result = result.replace(/IntInf\.toInt\s*\(/g, '(');

  // ── Strip SML type annotations ──
  // SML allows type annotations like  expr:TypeName  or  (expr):TypeName
  // e.g. (time()):int  →  (time())
  //      ("",[],(0,0),""):ProdRule  →  ("",[],(0,0),"")
  //      ((lb,ub):TimeInt)  →  ((lb,ub))
  // Only strip :TypeName after ) or after a word char (not inside strings)
  result = result.replace(/(\))\s*:[A-Za-z][A-Za-z0-9_]*/g, '$1');

  // ── SML record access: #N(expr) → Rhai not supported, keep with warning ──
  if (/#\d+\s*\(/.test(result)) {
    importWarnings.push(`${context}: SML record field access (#N) needs manual translation: "${expr}"`);
  }

  // ── Tuple conversion ──
  // SML tuple (a, b, ...) → Rhai array [a, b, ...]
  // Only convert if there's a comma at the top level inside outer parens
  // (to distinguish from grouping parens like "(x + 1)")
  result = convertSMLTuplesToRhaiArrays(result);

  // ── List operations ──
  // SML list cons: x::xs  →  Rhai: [x] + xs  (prepend element to list)
  // Must handle nested cons like a::b::l  →  [a, b] + l
  // Process right-to-left for proper nesting
  if (result.includes('::')) {
    const parts = result.split('::').map(s => s.trim());
    if (parts.length >= 2) {
      // Last part is the list tail, everything before is cons'ed elements
      const tail = parts[parts.length - 1];
      const heads = parts.slice(0, -1);
      result = `[${heads.join(', ')}] + ${tail}`;
    }
  }

  // SML list concatenation: l1^^l2  →  Rhai: l1 + l2
  result = result.replace(/\^\^/g, ' + ');

  // SML function definition: fun name(args) = body;  →  Rhai: fn name(args) { body }
  // This is for function code, not arc inscriptions
  result = result.replace(
    /^\s*fun\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([^)]*?)\)\s*=\s*(.+?)\s*;?\s*$/,
    (_match, name: string, args: string, body: string) => {
      // Unwrap array-destructured args: [a,b,...] → a,b,...  (from SML tuple patterns)
      let cleanArgs = args.replace(/^\[([^\]]*)\]$/, '$1');
      // Strip SML type annotations from parameters: q:Queue → q, (lb,ub):TimeInt → (lb,ub)
      cleanArgs = cleanArgs.replace(/\s*:[A-Za-z][A-Za-z0-9_]*/g, '');
      const translatedBody = translateSMLExpr(body.trim(), context);
      return `fn ${name}(${cleanArgs}) { ${translatedBody} }`;
    }
  );

  // SML if-then-else: if cond then e1 else e2  →  Rhai: if cond { e1 } else { e2 }
  // Uses recursive parser to properly handle nested if-then-else
  result = translateSMLIfThenElse(result);

  // SML not-equal: <> → Rhai: !=
  result = result.replace(/<>/g, '!=');

  // SML equality: = → Rhai: == (standalone = not part of ==, !=, >=, <=, =>)
  result = result.replace(/(?<![!<>=])=(?!=|>)/g, '==');

  // SML boolean operators: andalso → &&, orelse → ||
  result = result.replace(/\bandalso\b/g, '&&');
  result = result.replace(/\borelse\b/g, '||');

  // SML not  →  Rhai: !
  result = result.replace(/\bnot\s*\(/g, '!(');
  result = result.replace(/\bnot\s+([a-zA-Z_])/g, '!$1');

  // SML integer division: div  →  Rhai: /
  result = result.replace(/\bdiv\b/g, '/');

  // SML modulo: mod  →  Rhai: %
  result = result.replace(/\bmod\b/g, '%');

  // SML string concatenation: ^  →  Rhai: +  (only when not part of ^^)
  // This is tricky since ^ alone is string concat in SML
  // We skip this to avoid conflicts with ^^ list concat already handled

  // SML list functions: hd(l)  →  l[0], tl(l)  →  l.split(1)[1]
  // These are complex — mark as warning
  if (/\bhd\s*\(/.test(result) || /\btl\s*\(/.test(result)) {
    importWarnings.push(`${context}: SML list function (hd/tl) may need manual translation: "${expr}"`);
  }

  // SML let-in-end  →  mark as needing manual translation
  if (/\blet\b/.test(result) && /\bin\b/.test(result)) {
    importWarnings.push(`${context}: SML let-in expression may need manual translation: "${expr}"`);
  }

  // SML case-of  →  mark as needing manual translation
  if (/\bcase\b/.test(result) && /\bof\b/.test(result)) {
    importWarnings.push(`${context}: SML case-of expression needs manual translation: "${expr}"`);
  }

  // Detect remaining untranslatable SML syntax
  // Check for SML-style pattern matching, type annotations, etc.
  if (/\bfn\s+[a-zA-Z]/.test(result) && !result.startsWith('fn ')) {
    importWarnings.push(`${context}: SML anonymous function may need manual translation: "${expr}"`);
  }

  // If nothing changed and there's complex SML syntax remaining, warn
  if (result === original) {
    // Detect potential untranslated SML
    if (/\b(val|fun)\s/.test(result) && !result.startsWith('fn ')) {
      importWarnings.push(`${context}: SML syntax may need manual translation: "${expr}"`);
    }
  }

  return result;
}

/**
 * Translates an SML function definition to Rhai.
 * Handles the common pattern: fun name(args) = body;
 */
function translateSMLFunction(code: string, funcName: string): string {
  // Handle multiple function definitions in same code block (duplicates from CPN Tools)
  // Join all lines and take only the first complete definition (up to ';')
  const lines = code.split(/\n/).map(s => s.trim()).filter(s => s.length > 0);
  const joined = lines.join(' ');

  // Take up to the first semicolon (end of first function definition)
  const semiIndex = joined.indexOf(';');
  const firstDef = semiIndex >= 0 ? joined.slice(0, semiIndex + 1) : joined;

  // Detect SML pattern matching (multiple clauses with '|').  These can't be
  // auto-translated to Rhai, so store the original SML with a comment and warning.
  if (/\bfun\s+\w+.*\|\s*\w+/.test(firstDef)) {
    importWarnings.push(`Function "${funcName}": SML pattern matching cannot be auto-translated. Manual rewrite needed.`);
    return `// SML (needs manual translation): ${firstDef}`;
  }

  // Detect other untranslatable SML constructs (record field access #N(...))
  if (/#\d+\s*\(/.test(firstDef)) {
    importWarnings.push(`Function "${funcName}": Contains SML-specific constructs that need manual translation.`);
    return `// SML (needs manual translation): ${firstDef}`;
  }

  return translateSMLExpr(firstDef, `Function "${funcName}"`);
}

/**
 * Translates an SML guard expression for Rhai.
 */
function translateSMLGuard(guard: string, transitionName: string): string {
  if (!guard.trim()) return guard;
  
  // Guards in CPN Tools are enclosed in [...] brackets — strip them
  let result = guard.trim();
  if (result.startsWith('[') && result.endsWith(']')) {
    result = result.slice(1, -1).trim();
  }
  
  return translateSMLExpr(result, `Guard of transition "${transitionName}"`);
}

/**
 * Translates an SML arc inscription to Rhai.
 */
function translateSMLInscription(inscription: string, context: string): string {
  if (!inscription.trim()) return inscription;
  return translateSMLExpr(inscription, context);
}

/**
 * Parses an SML multiset literal into its constituent tokens.
 * Format: N`value ++ N`value ++ ...
 * where N is an integer multiplicity and value is an SML expression.
 * Returns null if the string doesn't look like a multiset literal.
 * 
 * Examples:
 *   1`"Dan Brown"++ 1`"John Grisham"
 *   → [{count:1, value:'"Dan Brown"'}, {count:1, value:'"John Grisham"'}]
 * 
 *   1`("Dan Brown","De Da Vinci code") ++ 1`("Dan Brown","Het Bernini mysterie")
 *   → [{count:1, value:'("Dan Brown","De Da Vinci code")'}, ...]
 */
function parseSMLMultiset(expr: string): Array<{ count: number; value: string }> | null {
  const s = expr.trim();
  // Quick check: must contain at least one N` pattern
  if (!/\d+`/.test(s)) return null;

  const tokens: Array<{ count: number; value: string }> = [];
  let pos = 0;

  while (pos < s.length) {
    // Skip whitespace
    while (pos < s.length && /\s/.test(s[pos])) pos++;
    if (pos >= s.length) break;

    // Skip ++ separator
    if (s.startsWith('++', pos)) {
      pos += 2;
      while (pos < s.length && /\s/.test(s[pos])) pos++;
      if (pos >= s.length) break;
    }

    // Expect: N`value
    const multMatch = s.slice(pos).match(/^(\d+)`/);
    if (!multMatch) return null; // Not a valid multiset pattern

    const count = parseInt(multMatch[1], 10);
    pos += multMatch[0].length;

    // Now parse the value — it can be:
    // - A string: "..."
    // - A tuple: (...)
    // - A list: [...]
    // - A record: {...}
    // - A simple token: identifier or number
    const valueStart = pos;
    
    if (s[pos] === '"') {
      // String value — find matching closing quote
      pos++;
      while (pos < s.length && s[pos] !== '"') {
        if (s[pos] === '\\') pos++; // skip escaped char
        pos++;
      }
      if (pos < s.length) pos++; // skip closing quote
    } else if (s[pos] === '(') {
      // Tuple — find matching closing paren, respecting nesting and strings
      pos = skipBracketedExpr(s, pos, '(', ')');
    } else if (s[pos] === '[') {
      // List — find matching closing bracket
      pos = skipBracketedExpr(s, pos, '[', ']');
    } else if (s[pos] === '{') {
      // Record — find matching closing brace
      pos = skipBracketedExpr(s, pos, '{', '}');
    } else {
      // Simple value (number, identifier) — read until whitespace or ++
      while (pos < s.length && !/\s/.test(s[pos]) && !s.startsWith('++', pos)) {
        pos++;
      }
    }

    const value = s.slice(valueStart, pos).trim();
    if (!value) return null;
    tokens.push({ count, value });
  }

  return tokens.length > 0 ? tokens : null;
}

/**
 * Skips a bracketed expression in a string, respecting nesting and string literals.
 * Returns the position after the closing bracket.
 */
function skipBracketedExpr(s: string, pos: number, open: string, close: string): number {
  let depth = 0;
  while (pos < s.length) {
    if (s[pos] === '"') {
      // Skip string literal
      pos++;
      while (pos < s.length && s[pos] !== '"') {
        if (s[pos] === '\\') pos++;
        pos++;
      }
      if (pos < s.length) pos++;
    } else if (s[pos] === open) {
      depth++;
      pos++;
    } else if (s[pos] === close) {
      depth--;
      pos++;
      if (depth === 0) break;
    } else {
      pos++;
    }
  }
  return pos;
}

type ColorSetArray = Array<{ id: string; name: string; type: string; definition: string; color: string }>;

/**
 * Returns the component color set names for a product type, e.g.
 * "colset AA = product Author * Article;" → ["Author", "Article"]
 */
function getProductComponentTypes(colorSetName: string, colorSets: ColorSetArray): string[] | null {
  const cs = colorSets.find(c => c.name === colorSetName);
  if (!cs || cs.type !== 'product') return null;
  const match = cs.definition.match(/=\s*product\s+(.+?)\s*;?\s*$/);
  if (!match) return null;
  return match[1].split('*').map(s => s.trim());
}

/**
 * Returns the element color set name for a list type, e.g.
 * "colset AL = list Article;" → "Article"
 */
function getListElementType(colorSetName: string, colorSets: ColorSetArray): string | null {
  const cs = colorSets.find(c => c.name === colorSetName);
  if (!cs || cs.type !== 'list') return null;
  const match = cs.definition.match(/=\s*list\s+(\w+)\s*;?\s*$/);
  if (!match) return null;
  return match[1];
}

/**
 * Translates a single SML token value to Rhai syntax.
 * Uses color set type information to correctly parse product tuples, lists, etc.
 */
function translateSMLTokenValue(
  value: string,
  colorSetName: string,
  colorSets: ColorSetArray,
): string {
  const v = value.trim();

  // Look up color set type info
  const productComponents = getProductComponentTypes(colorSetName, colorSets);

  // Tuple value: (a, b, ...) → [a, b, ...] (Rhai array = product token)
  if (v.startsWith('(') && v.endsWith(')')) {
    // Split the tuple components, respecting nested strings and parens
    const inner = v.slice(1, -1);
    const components = splitTupleComponents(inner);
    // Recursively translate each component with the correct component color set
    const translated = components.map((c, i) => {
      const componentCS = productComponents?.[i] ?? '';
      return translateSMLTokenValue(c.trim(), componentCS, colorSets);
    });
    return `[${translated.join(', ')}]`;
  }

  // If color set is a product but value isn't in tuple syntax (no outer parens),
  // try splitting as comma-separated components — this handles cases like
  // "Dan Brown","Article" without enclosing parens
  if (productComponents && productComponents.length > 1) {
    const components = splitTupleComponents(v);
    if (components.length === productComponents.length) {
      const translated = components.map((c, i) =>
        translateSMLTokenValue(c.trim(), productComponents[i], colorSets)
      );
      return `[${translated.join(', ')}]`;
    }
  }

  // String value: already in correct format
  if (v.startsWith('"') && v.endsWith('"')) return v;

  // List value: [...] — recursively translate elements with the element type
  if (v.startsWith('[') && v.endsWith(']')) {
    const elementType = getListElementType(colorSetName, colorSets);
    if (elementType) {
      const inner = v.slice(1, -1).trim();
      if (!inner) return '[]'; // empty list
      const elements = splitTupleComponents(inner);
      const translated = elements.map(e =>
        translateSMLTokenValue(e.trim(), elementType, colorSets)
      );
      return `[${translated.join(', ')}]`;
    }
    return v;
  }

  // Number
  if (/^-?\d+(\.\d+)?$/.test(v)) return v;

  // Boolean
  if (v === 'true' || v === 'false') return v;

  // Unit
  if (v === '()') return '()';

  // Fall through: return as-is (could be an identifier or complex expression)
  return v;
}

/**
 * Splits comma-separated tuple components, respecting nested parens and string literals.
 */
function splitTupleComponents(inner: string): string[] {
  const components: string[] = [];
  let current = '';
  let depth = 0;
  let inString = false;

  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (inString) {
      current += ch;
      if (ch === '\\' && i + 1 < inner.length) {
        current += inner[++i];
      } else if (ch === '"') {
        inString = false;
      }
    } else if (ch === '"') {
      inString = true;
      current += ch;
    } else if (ch === '(' || ch === '[' || ch === '{') {
      depth++;
      current += ch;
    } else if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
      current += ch;
    } else if (ch === ',' && depth === 0) {
      components.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) components.push(current);
  return components;
}

/**
 * Translates an SML initial marking expression.
 * Handles UNIT markings and common SML patterns.
 */
function translateSMLInitialMarking(
  marking: string,
  placeName: string,
  colorSetName: string,
  colorSets: ColorSetArray,
): string {
  let trimmed = marking.trim();
  if (!trimmed) return '';

  // Strip CPN Tools timed-token timestamps: value@N → value
  // In CPN Tools, "Mary"@6 means token "Mary" available at time 6.
  // Rhai doesn't understand @ syntax, so strip the timestamps.
  // Matches @N after a closing quote, paren, bracket, brace, or word character.
  if (trimmed.includes('@')) {
    trimmed = trimmed.replace(/(["\])\w])@\d+/g, '$1');
  }

  // Handle UNIT place markings
  // The UI stores UNIT markings in array format: "[(), (), ...]" parsed by parseUnitMarkingCount
  if (colorSetName === 'UNIT' || colorSetName === 'unit') {
    // "()" means one unit token
    if (trimmed === '()') return '[()]';
    // N`() or N'() means N unit tokens → convert to array format
    const multiUnitMatch = trimmed.match(/^(\d+)[`']\(\)$/);
    if (multiUnitMatch) {
      const n = parseInt(multiUnitMatch[1], 10);
      if (n <= 0) return '';
      const units = Array(n).fill('()').join(', ');
      return `[${units}]`;
    }
    // If it's just a number like "1" for a UNIT place, it means that many unit tokens
    if (/^\d+$/.test(trimmed)) {
      const n = parseInt(trimmed, 10);
      if (n <= 0) return ''; // No tokens
      const units = Array(n).fill('()').join(', ');
      return `[${units}]`;
    }
  }

  // Handle list type markings — check if color set is a list type
  const cs = colorSets.find(c => c.name === colorSetName);
  if (cs && cs.definition.includes('= list ')) {
    // Empty list markings: [] means ONE token whose value is the empty list
    // We store this as [[]] to distinguish from "no tokens" which would be ""
    if (trimmed === '[]' || trimmed === 'nil' || trimmed === 'empty') return '[[]]';
    // N`[] or N'[] means N empty-list tokens
    const multiListMatch = trimmed.match(/^(\d+)[`']\[\]$/);
    if (multiListMatch) {
      const n = parseInt(multiListMatch[1], 10);
      if (n <= 0) return '';
      const lists = Array(n).fill('[]').join(', ');
      return `[${lists}]`;
    }
    // Bare list literal [a,b,c] (without backtick multiset notation) means ONE token
    // whose value is this list. Wrap it as [[a,b,c]] so the outer array represents
    // the multiset of tokens and the inner array is the token's list value.
    if (trimmed.startsWith('[') && trimmed.endsWith(']') && !parseSMLMultiset(trimmed)) {
      return `[${trimmed}]`;
    }
  }

  // Handle SML multiset notation: N`value ++ N`value ++ ...
  // The backtick separates multiplicity from value, ++ is multiset union
  const multisetTokens = parseSMLMultiset(trimmed);
  if (multisetTokens !== null) {
    // Convert each token value from SML to Rhai
    const rhaiTokens: string[] = [];
    for (const { count, value } of multisetTokens) {
      // Translate the value (e.g., SML tuple ("a","b") → Rhai ["a","b"])
      const rhaiValue = translateSMLTokenValue(value, colorSetName, colorSets);
      for (let i = 0; i < count; i++) {
        rhaiTokens.push(rhaiValue);
      }
    }
    return `[${rhaiTokens.join(', ')}]`;
  }

  // Apply general SML→Rhai translation
  return translateSMLExpr(trimmed, `Initial marking of place "${placeName}"`);
}

// Parse CPN Tools XML
function parseCPNToolsXML(content: string): PetriNetData {
  // Clear any previous import warnings
  importWarnings.length = 0;

  const parser = new DOMParser();
  const cpnXML = parser.parseFromString(content, 'text/xml');

  const petriNetsById: Record<string, PetriNet> = {};
  const petriNetOrder: string[] = [];

  // Parse color sets
  const colorSets = Array.from(cpnXML.querySelectorAll('globbox color')).map((color) => {
    const id = color.querySelector('id')?.textContent || '';
    
    // Detect timed suffix (applies to all color set types)
    const isTimed = !!color.querySelector('timed');
    const timedSuffix = isTimed ? ' timed' : '';

    // Check for product type
    const productElement = color.querySelector('product');
    if (productElement) {
      const productIds = Array.from(productElement.querySelectorAll(':scope > id')).map(el => el.textContent || '');
      const definition = `colset ${id} = product ${productIds.join(' * ')}${timedSuffix};`;
      return {
        id,
        name: id,
        type: 'product',
        definition,
        color: generateRandomColor(),
        ...(isTimed ? { timed: true } : {}),
      };
    }
    
    // Check for int with range (e.g., <int><with><ml>0</ml><ml>10</ml></with></int>)
    const intElement = color.querySelector('int');
    if (intElement) {
      const withElement = intElement.querySelector('with');
      if (withElement) {
        const mlElements = withElement.querySelectorAll('ml');
        if (mlElements.length >= 2) {
          const rangeStart = mlElements[0].textContent || '0';
          const rangeEnd = mlElements[1].textContent || '0';
          const definition = `colset ${id} = int with ${rangeStart}..${rangeEnd}${timedSuffix};`;
          return {
            id,
            name: id,
            type: 'basic',
            definition,
            color: generateRandomColor(),
            ...(isTimed ? { timed: true } : {}),
          };
        }
      }
      // Plain int without range
      return {
        id,
        name: id,
        type: 'basic',
        definition: `colset ${id} = int${timedSuffix};`,
        color: generateRandomColor(),
        ...(isTimed ? { timed: true } : {}),
      };
    }
    
    // Check for list type (e.g., <list><id>CityCat</id></list>)
    const listElement = color.querySelector('list');
    if (listElement) {
      const elementType = listElement.querySelector('id')?.textContent || '';
      const definition = `colset ${id} = list ${elementType}${timedSuffix};`;
      return {
        id,
        name: id,
        type: 'list',
        definition,
        color: generateRandomColor(),
        ...(isTimed ? { timed: true } : {}),
      };
    }

    // Check for enum type (e.g., <enum><id>Corona</id><id>Heineken</id>...</enum>)
    const enumElement = color.querySelector('enum');
    if (enumElement) {
      const enumValues = Array.from(enumElement.querySelectorAll(':scope > id')).map(el => el.textContent || '');
      const definition = `colset ${id} = with ${enumValues.join('|')}${timedSuffix};`;
      return {
        id,
        name: id,
        type: 'enum',
        definition,
        color: generateRandomColor(),
        ...(isTimed ? { timed: true } : {}),
      };
    }
    
    // Check for other basic types without children
    const basicTypeElement = Array.from(color.children).find((child) => {
      const tagName = child.tagName.toLowerCase();
      return ['bool', 'string', 'real', 'unit', 'time', 'intinf'].includes(tagName);
    });
    const basicType = basicTypeElement ? basicTypeElement.tagName.toLowerCase() : null;
    const layout = color.querySelector('layout')?.textContent || '';
    const definition = basicType ? `colset ${id} = ${basicType}${timedSuffix};` : (layout || `colset ${id} = complex;`);

    return {
      id,
      name: id,
      type: basicType ? 'basic' : 'complex',
      definition,
      color: generateRandomColor(),
      ...(isTimed ? { timed: true } : {}),
    };
  });

  // Parse variables
  const variables = Array.from(cpnXML.querySelectorAll('globbox var')).flatMap((variable) => {
    const idBase = variable.getAttribute('id') || uuidv4(); // Use base ID for potential multiple vars
    const colorSet = variable.querySelector('type > id')?.textContent || '';
    const layout = variable.querySelector('layout')?.textContent || '';

    // First try to get variable names from <id> elements (CPN Tools format can have multiple <id> after <type>)
    // The structure is: <var><type><id>ColorSet</id></type><id>var1</id><id>var2</id>...</var>
    const idElements = Array.from(variable.querySelectorAll(':scope > id'));
    if (idElements.length > 0) {
      return idElements.map((idEl, index) => ({
        id: `${idBase}_${index}`,
        name: idEl.textContent || '',
        colorSet,
      }));
    }

    // Fallback: Match 'var' followed by names (comma-separated) and then ':' and the type from layout
    const namesMatch = layout.match(/var\s+([^:]+):/);
    if (!namesMatch || !namesMatch[1]) {
      console.warn(`Could not parse variable names from layout: ${layout}`);
      return []; // Skip if layout doesn't match expected format
    }

    const names = namesMatch[1].split(',').map(name => name.trim()).filter(name => name);

    // Create a variable object for each name found
    return names.map((name, index) => ({
      id: `${idBase}_${index}`, // Generate unique ID for each variable derived from the same tag
      name,
      colorSet,
    }));
  });

  // Parse all <ml> elements (functions, val constants)
  // Collect from both top-level and block-nested ml elements, deduplicating by id
  const valDeclarations: { id: string; name: string; value: string }[] = [];
  const functions: Function[] = [];
  const seenMlIds = new Set<string>();

  const processMlElement = (ml: Element) => {
    const id = ml.getAttribute('id') || uuidv4();
    if (seenMlIds.has(id)) return;
    seenMlIds.add(id);

    // Get content from layout or text content
    const layout = ml.querySelector('layout')?.textContent?.trim() || '';
    const textContent = ml.textContent?.trim() || '';
    const content = layout || textContent;
    if (!content) return;

    // Check if it's a function definition (starts with 'fun')
    if (content.startsWith('fun ')) {
      const nameMatch = content.match(/^fun\s+([a-zA-Z0-9_]+)/);
      const functionName = nameMatch ? nameMatch[1] : `func_${id}`;
      functions.push({
        id,
        name: functionName,
        code: translateSMLFunction(content, functionName),
      });
      return;
    }

    // Check if it's a val declaration — store for later processing
    // Use [\s\S] instead of . to handle multi-line val declarations
    const valMatch = content.match(/^val\s+(\w+)\s*=\s*([\s\S]+?)\s*;?\s*$/);
    if (valMatch) {
      // Join multi-line values into a single line
      const value = valMatch[2].trim().split(/\n/).map(s => s.trim()).join(' ');
      valDeclarations.push({
        id,
        name: valMatch[1],
        value,
      });
      return;
    }

    // Other ml content (e.g., globref, arbitrary SML) — store as function
    const nameMatch = content.match(/^(?:fun|val)?\s*([a-zA-Z0-9_]+)/);
    const name = nameMatch ? nameMatch[1] : `ml_${id}`;
    functions.push({
      id,
      name,
      code: translateSMLExpr(content, `ML declaration "${name}"`),
    });
  };

  // Process ml elements that are direct children of globbox or block (not nested in color/int/with)
  const mlElements = [
    ...Array.from(cpnXML.querySelectorAll('globbox > ml')),
    ...Array.from(cpnXML.querySelectorAll('globbox > block > ml')),
  ];
  mlElements.forEach(processMlElement);

  // Parse <use> declarations
  const uses = Array.from(cpnXML.querySelectorAll('globbox use')).map((use) => {
    const mlContent = use.querySelector('ml')?.textContent || '';
    const layoutContent = use.querySelector('layout')?.textContent || '';
    const nameMatch = mlContent.match(/"([^"]+)"/) || layoutContent.match(/"([^"]+)"/);
    const name = nameMatch ? nameMatch[1] : '';
    return {
      id: uuidv4(),
      name,
      content: '', // Content is not parsed but can be edited later
    };
  });

  // Add val declarations as values (named constants)
  const values: Value[] = [];
  for (const valDecl of valDeclarations) {
    const translatedValue = translateSMLExpr(valDecl.value, `val ${valDecl.name}`);
    values.push({
      id: valDecl.id,
      name: valDecl.name,
      expression: translatedValue,
    });
  }

  // Parse pages
  const pages = Array.from(cpnXML.querySelectorAll('page'));
  pages.forEach((page) => {
    const pageId = page.getAttribute('id') || uuidv4();
    const pageName = page.querySelector('pageattr')?.getAttribute('name') || `Page ${pageId}`;

    // Helper to create inscription nodes as children
    // Note: React Flow child node positions are relative to parent's TOP-LEFT corner
    const createInscriptionNode = (
      parentId: string,
      parentCenterX: number,
      parentCenterY: number,
      parentWidth: number,
      parentHeight: number,
      element: Element | null,
      inscriptionType: string,
      textSelector: string = 'text'
    ) => {
      if (!element) return null;
      const text = element.querySelector(textSelector)?.textContent || '';
      if (!text.trim()) return null;
      
      const posattr = element.querySelector('posattr');
      if (!posattr) return null;
      
      const absX = parseFloat(posattr.getAttribute('x') || '0');
      const absY = -parseFloat(posattr.getAttribute('y') || '0'); // Invert y
      
      // Parent's top-left corner in absolute coordinates
      const parentTopLeftX = parentCenterX - parentWidth / 2;
      const parentTopLeftY = parentCenterY - parentHeight / 2;
      
      // Convert absolute position to relative offset from parent's top-left
      const relX = absX - parentTopLeftX;
      const relY = absY - parentTopLeftY;
      
      // Get color from textattr if available
      const textattr = element.querySelector('textattr');
      const color = textattr?.getAttribute('colour') || undefined;
      
      return {
        id: element.getAttribute('id') || uuidv4(),
        type: 'inscription',
        position: { x: relX, y: relY },
        parentId: parentId,
        draggable: true,
        data: {
          label: text,
          inscriptionType,
          color,
        },
      };
    };

    // Parse places with their inscriptions
    const placesWithInscriptions = Array.from(page.querySelectorAll('place')).flatMap((place) => {
      const ellipse = place.querySelector('ellipse');
      const width = ellipse ? parseFloat(ellipse.getAttribute('w') || '60') : 60;
      const height = ellipse ? parseFloat(ellipse.getAttribute('h') || '40') : 40;
      
      const rawInitialMarking = place.querySelector('initmark text')?.textContent || '';
      
      const centerX = parseFloat(place.querySelector('posattr')?.getAttribute('x') || '0');
      const centerY = -parseFloat(place.querySelector('posattr')?.getAttribute('y') || '0');
      
      const placeId = place.getAttribute('id') || uuidv4();
      
      // Calculate colorSet label offset from place center (for PlaceNode's DraggableInscription)
      const typeElement = place.querySelector('type');
      let colorSetOffset: { x: number; y: number } | undefined;
      if (typeElement) {
        const typePosattr = typeElement.querySelector('posattr');
        if (typePosattr) {
          const typeX = parseFloat(typePosattr.getAttribute('x') || '0');
          const typeY = -parseFloat(typePosattr.getAttribute('y') || '0');
          colorSetOffset = {
            x: typeX - centerX,
            y: typeY - centerY,
          };
        }
      }
      
      // Calculate initialMarking label offset from place center
      const initmarkElement = place.querySelector('initmark');
      let markingOffset: { x: number; y: number } | undefined;
      if (initmarkElement) {
        const initmarkPosattr = initmarkElement.querySelector('posattr');
        if (initmarkPosattr) {
          const initmarkX = parseFloat(initmarkPosattr.getAttribute('x') || '0');
          const initmarkY = -parseFloat(initmarkPosattr.getAttribute('y') || '0');
          markingOffset = {
            x: initmarkX - centerX,
            y: initmarkY - centerY,
          };
        }
      }
      
      const placeName = place.querySelector('text')?.textContent || '';
      const placeColorSet = place.querySelector('type text')?.textContent || '';
      
      // Parse port type for places on subpages
      const portElement = place.querySelector('port');
      const rawPortType = portElement?.getAttribute('type')?.toLowerCase();
      const portType = rawPortType === 'in' ? 'in' as const
        : rawPortType === 'out' ? 'out' as const
        : rawPortType === 'i/o' ? 'io' as const
        : undefined;
      
      const placeNode = {
        id: placeId,
        type: 'place',
        position: {
          x: centerX - width / 2,
          y: centerY - height / 2,
        },
        width,
        height,
        data: {
          label: placeName,
          colorSet: placeColorSet,
          initialMarking: translateSMLInitialMarking(rawInitialMarking, placeName, placeColorSet, colorSets),
          colorSetOffset,
          markingOffset,
          ...(portType ? { portType } : {}),
        },
      };
      
      // Don't create separate inscription nodes for colorSet and initialMarking
      // as PlaceNode handles these internally with DraggableInscription
      return [placeNode];
    });

    // Parse transitions with their inscriptions
    const transitionsWithInscriptions = Array.from(page.querySelectorAll('trans')).flatMap((transition) => {
      const box = transition.querySelector('box');
      const width = box ? parseFloat(box.getAttribute('w') || '60') : 60;
      const height = box ? parseFloat(box.getAttribute('h') || '40') : 40;
      
      const centerX = parseFloat(transition.querySelector('posattr')?.getAttribute('x') || '0');
      const centerY = -parseFloat(transition.querySelector('posattr')?.getAttribute('y') || '0');
      
      const transId = transition.getAttribute('id') || uuidv4();
      
      const transName = transition.querySelector('text')?.textContent || '';
      const rawGuard = transition.querySelector('cond text')?.textContent || '';
      
      // Parse substitution transition (hierarchy)
      const substElement = transition.querySelector('subst');
      let subPageId: string | undefined;
      let socketAssignments: { portPlaceId: string; socketPlaceId: string }[] | undefined;
      if (substElement) {
        subPageId = substElement.getAttribute('subpage') || undefined;
        const portsockAttr = substElement.getAttribute('portsock') || '';
        // Format: (portId,socketId)(portId,socketId)...
        const pairs = portsockAttr.matchAll(/\(([^,]+),([^)]+)\)/g);
        const assignments = Array.from(pairs).map(m => ({
          portPlaceId: m[1],
          socketPlaceId: m[2],
        }));
        if (assignments.length > 0) {
          socketAssignments = assignments;
        }
      }
      
      const transNode = {
        id: transId,
        type: 'transition',
        position: {
          x: centerX - width / 2,
          y: centerY - height / 2,
        },
        width,
        height,
        data: {
          label: transName,
          guard: translateSMLGuard(rawGuard, transName),
          time: transition.querySelector('time text')?.textContent || '',
          priority: transition.querySelector('priority text')?.textContent || '',
          ...(subPageId ? { subPageId } : {}),
          ...(socketAssignments ? { socketAssignments } : {}),
        },
      };
      
      // Create inscription child nodes
      const inscriptions = [
        createInscriptionNode(transId, centerX, centerY, width, height, transition.querySelector('cond'), 'guard'),
        createInscriptionNode(transId, centerX, centerY, width, height, transition.querySelector('time'), 'time'),
        createInscriptionNode(transId, centerX, centerY, width, height, transition.querySelector('priority'), 'priority'),
        createInscriptionNode(transId, centerX, centerY, width, height, transition.querySelector('code'), 'codeSegment'),
      ].filter((n): n is NonNullable<typeof n> => n !== null);
      
      return [transNode, ...inscriptions];
    });

    // Parse arcs - handle BOTHDIR (bidirectional) by creating two separate arcs
    const arcs = Array.from(page.querySelectorAll('arc')).flatMap((arc) => {
      const id = arc.getAttribute('id') || uuidv4();
      const orientation = arc.getAttribute('orientation');
      const order = parseInt(arc.getAttribute('order') || '0', 10); // Parse order for parallel arc offset
      const placeEndRef = arc.querySelector('placeend')?.getAttribute('idref') || '';
      const transEndRef = arc.querySelector('transend')?.getAttribute('idref') || '';

      const rawLabel = arc.querySelector('annot text')?.textContent || '';
      
      // Split @+ arc delay from inscription (CPN Tools format: "expr @+ delay")
      let label = rawLabel;
      let arcDelay = '';
      const atPlusIndex = rawLabel.indexOf('@+');
      if (atPlusIndex !== -1) {
        label = rawLabel.substring(0, atPlusIndex).trim();
        arcDelay = rawLabel.substring(atPlusIndex + 2).trim();
      }
      
      // Translate SML arc inscription to Rhai
      label = translateSMLInscription(label, `Arc inscription (arc ${id})`);
      if (arcDelay) {
        arcDelay = translateSMLExpr(arcDelay, `Arc delay (arc ${id})`);
      }
      
      // Parse bendpoints for curved/bent arcs
      const bendpoints = Array.from(arc.querySelectorAll('bendpoint')).map((bp) => ({
        x: parseFloat(bp.querySelector('posattr')?.getAttribute('x') || '0'),
        y: -parseFloat(bp.querySelector('posattr')?.getAttribute('y') || '0'), // Invert y-coordinate
      }));

      if (orientation === 'BOTHDIR') {
        // Create a single double-headed arc (arrows on both ends)
        return [{
          id,
          type: 'floating',
          source: placeEndRef,
          target: transEndRef,
          label,
          data: { bendpoints, isBidirectional: true, order, ...(arcDelay ? { delay: arcDelay } : {}) },
        }];
      }

      let source: string;
      let target: string;

      if (orientation === 'PtoT') {
        source = placeEndRef;
        target = transEndRef;
      } else if (orientation === 'TtoP') {
        source = transEndRef;
        target = placeEndRef;
      } else {
        // Handle other orientations or default case if needed
        source = placeEndRef;
        target = transEndRef;
        console.warn(`Unhandled arc orientation: ${orientation} for arc ${id}. Assuming PtoT.`);
      }

      return [{
        id,
        type: 'floating',
        source,
        target,
        label,
        data: { bendpoints, order, ...(arcDelay ? { delay: arcDelay } : {}) },
      }];
    });

    // Parse Aux (auxiliary text) elements
    // CPN Tools positions are center-based, CSS transform handles centering
    const auxNodes = Array.from(page.querySelectorAll('Aux')).map((aux) => {
      const id = aux.getAttribute('id') || uuidv4();
      const text = aux.querySelector('text')?.textContent || '';
      const centerX = parseFloat(aux.querySelector('posattr')?.getAttribute('x') || '0');
      const centerY = -parseFloat(aux.querySelector('posattr')?.getAttribute('y') || '0'); // Invert y-coordinate
      
      // Get color and bold from textattr
      const textattr = aux.querySelector('textattr');
      const color = textattr?.getAttribute('colour') || undefined;
      const bold = textattr?.getAttribute('bold') === 'true';
      
      // Position at center - CSS transform: translate(-50%, -50%) handles centering
      return {
        id,
        type: 'auxText',
        position: { 
          x: centerX, 
          y: centerY,
        },
        data: {
          label: text,
          color,
          bold,
        },
      };
    });

    // Create Petri net for the page
    const petriNet: PetriNet = {
      id: pageId,
      name: pageName,
      nodes: [...placesWithInscriptions, ...transitionsWithInscriptions, ...auxNodes],
      edges: arcs,
      selectedElement: null,
    };

    petriNetsById[pageId] = petriNet;
    petriNetOrder.push(pageId);
  });

  // Build priorities from val declarations that are referenced as transition priorities
  const priorities: { id: string; name: string; level: number }[] = [];
  const referencedPriorityNames = new Set<string>();
  for (const net of Object.values(petriNetsById)) {
    for (const node of net.nodes) {
      if (node.type === 'transition' && node.data?.priority && typeof node.data.priority === 'string') {
        referencedPriorityNames.add(node.data.priority);
      }
    }
  }
  for (const valDecl of valDeclarations) {
    if (referencedPriorityNames.has(valDecl.name) && /^\d+$/.test(valDecl.value)) {
      priorities.push({
        id: uuidv4(),
        name: valDecl.name,
        level: parseInt(valDecl.value, 10),
      });
    }
  }

  return {
    petriNetsById,
    petriNetOrder,
    colorSets,
    variables,
    priorities,
    functions,
    uses, // Add uses to the returned data
    values, // Add values (named constants) to the returned data
    importWarnings: importWarnings.length > 0 ? [...importWarnings] : undefined,
  };
}

// Parse cpn-py JSON
function parseCPNPyJSON(content: string): PetriNetData {
  const json = JSON.parse(content);

  // Parse places
  const places = json.places.map((place: { name: string; colorSet: string }) => ({
    id: uuidv4(),
    type: "place",
    position: { x: 0, y: 0 }, // Default position
    data: {
      label: place.name,
      colorSet: place.colorSet,
      initialMarking: json.initialMarking[place.name]?.tokens.map((token: string | number | (string | number)[]) =>
        Array.isArray(token) ? token : [token]
      ) || [],
    },
  }));

  // Parse transitions
  const transitions = json.transitions.map((transition: { name: string; guard: string; variables: string[] }) => ({
    id: uuidv4(),
    type: "transition",
    position: { x: 0, y: 0 }, // Default position
    data: {
      label: transition.name,
      guard: transition.guard,
      variables: transition.variables,
    },
  }));

  // Parse edges
  const edges = json.transitions.flatMap((transition: { name: string; inArcs: { place: string; expression: string }[]; outArcs: { place: string; expression: string }[] }) => {
    const transitionNode = transitions.find((t: TransitionNodeProps) => t.data.label === transition.name);

    return [
      ...transition.inArcs.map((arc: { place: string; expression: string }) => ({
        id: uuidv4(),
        source: places.find((place: PlaceNodeProps) => place.data.label === arc.place)?.id || "",
        target: transitionNode?.id || "",
        label: arc.expression,
      })),
      ...transition.outArcs.map((arc: { place: string; expression: string }) => ({
        id: uuidv4(),
        source: transitionNode?.id || "",
        target: places.find((place: PlaceNodeProps) => place.data.label === arc.place)?.id || "",
        label: arc.expression,
      })),
    ];
  });

  // Create a default Petri net with all nodes and edges
  const defaultPetriNetId = uuidv4();
  const defaultPetriNet: PetriNet = {
    id: defaultPetriNetId,
    name: "Default Petri Net",
    nodes: [...places, ...transitions],
    edges,
    selectedElement: null,
  };

  return {
    petriNetsById: {
      [defaultPetriNetId]: defaultPetriNet,
    },
    petriNetOrder: [defaultPetriNetId],
    colorSets: json.colorSets.map((definition: string) => ({
      id: uuidv4(),
      name: definition.split(" ")[1], // Extract name from definition
      type: "basic", // Default type
      definition,
      color: generateRandomColor(),
    })),
    variables: [], // Variables are not defined in cpn-py JSON
    priorities: [], // Priorities are not defined in cpn-py JSON
    functions: [], // Functions are not defined in cpn-py JSON
    uses: [], // Uses are not defined in cpn-py JSON
    values: [], // Values are not defined in cpn-py JSON
  };
}

