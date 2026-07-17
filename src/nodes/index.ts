import { PlaceNode } from './PlaceNode';
import TransitionNode from './TransitionNode';
import AuxTextNode from './AuxTextNode';
import InscriptionNode from './InscriptionNode';

export const initialNodes = [
  { id: 'a',
    type: 'place',
    position: { x: -200, y: 0 },
    width: 30,
    height: 30,
    data: { label: 'start', colorSet: 'INT', initialMarking: '[1, 5, 5, 10]', marking: [1, 5, 5, 10], colorSetOffset: { x: 3.5623937890298656, y: 21.344157142052183 }, tokenCountOffset: { x: 25, y: -20 }, markingOffset: { x: 40, y: -25 } }
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
    position: { x: 20.186898137835904, y: 190.5002832292537 },
    width: 65,
    height: 31,
    data: { label: 'end place', colorSet: 'INT', initialMarking: '', marking: [], colorSetOffset: { x: 18.405701243320973, y: 21.937889440223827 } },
  },
];

export const nodeTypes = {
  'place': PlaceNode,
  'transition': TransitionNode,
  'auxText': AuxTextNode,
  'inscription': InscriptionNode,
};
