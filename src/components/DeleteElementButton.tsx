import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Trash2 } from 'lucide-react';
import useStore from '@/stores/store';

interface DeleteElementButtonProps {
  elementType: 'node' | 'edge';
  elementId: string;
  elementLabel?: string;
}

export function DeleteElementButton({ elementType, elementId, elementLabel }: DeleteElementButtonProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const activePetriNetId = useStore((state) => state.activePetriNetId);
  const setNodes = useStore((state) => state.setNodes);
  const setEdges = useStore((state) => state.setEdges);
  const setSelectedElement = useStore((state) => state.setSelectedElement);

  const displayName = elementLabel || elementId;
  const typeName = elementType === 'node' ? 'element' : 'arc';

  const handleDelete = () => {
    if (!activePetriNetId) return;

    const state = useStore.getState();
    const petriNet = state.petriNetsById[activePetriNetId];
    if (!petriNet) return;

    if (elementType === 'node') {
      // Remove the node and all connected edges
      const newNodes = petriNet.nodes.filter((n) => n.id !== elementId);
      const newEdges = petriNet.edges.filter((e) => e.source !== elementId && e.target !== elementId);
      setNodes(activePetriNetId, newNodes);
      setEdges(activePetriNetId, newEdges);
    } else {
      // Remove just the edge
      const newEdges = petriNet.edges.filter((e) => e.id !== elementId);
      setEdges(activePetriNetId, newEdges);
    }

    // Clear selection
    setSelectedElement(activePetriNetId, null);
    setConfirmOpen(false);
  };

  return (
    <>
      <Button
        variant="outline"
        size="icon"
        className="text-muted-foreground hover:text-destructive"
        onClick={() => setConfirmOpen(true)}
        title={`Delete ${typeName}`}
      >
        <Trash2 className="h-4 w-4" />
      </Button>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete {typeName}</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete {typeName === 'arc' ? 'the arc' : `"${displayName}"`}?
              {elementType === 'node' && ' All connected arcs will also be removed.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
