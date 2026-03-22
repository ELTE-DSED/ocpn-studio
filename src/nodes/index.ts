import { PlaceNode } from './PlaceNode';
import TransitionNode from './TransitionNode';
import AuxTextNode from './AuxTextNode';
import InscriptionNode from './InscriptionNode';

export const initialNodes = [
  { id: 'a',
    type: 'place',
    position: { x: -200, y: 0 },
    data: { label: 'start', colorSet: 'INT', initialMarking: '[1, 5, 5, 10]', marking: [1, 5, 5, 10], tokenCountOffset: { x: 25, y: -20 }, markingOffset: { x: 40, y: -25 } }
  },
  {
    id: 'b',
    type: 'transition',
    position: { x: -110, y: 100 },
    width: 70,
    height: 30,
    data: { label: 'transition', guard: 'var1>4', time: '', priority: '', codeSegment: '' },
  },
  {
    id: 'c',
    type: 'place',
    position: { x: 0, y: 200 },
    width: 50,
    height: 30,
    data: { label: 'end place', colorSet: 'INT', initialMarking: '', marking: [] },
  },
];

export const nodeTypes = {
  'place': PlaceNode,
  'transition': TransitionNode,
  'auxText': AuxTextNode,
  'inscription': InscriptionNode,
};
