'use client'
/**
 * Drag-and-drop sortable grid for tile dashboards (analytics, reports).
 *
 * Each item can carry a `className` (e.g. `col-span-2`) that gets applied to
 * the outer sortable wrapper — critical so the grid sizing survives drag.
 */
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
  KeyboardSensor,
  closestCenter,
} from '@dnd-kit/core'
import { restrictToParentElement } from '@dnd-kit/modifiers'
import {
  SortableContext,
  rectSortingStrategy,
  useSortable,
  sortableKeyboardCoordinates,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'

export interface SortableItem {
  id:         string
  /** Tailwind classes applied to the outer sortable wrapper (col-span etc). */
  className?: string
}

export function SortableTileGrid<T extends SortableItem>({
  items,
  onReorder,
  editing,
  renderTile,
  className,
}: {
  items:    T[]
  onReorder:(next: T[]) => void
  editing:  boolean
  renderTile: (item: T, idx: number) => React.ReactNode
  /** Class applied to the grid container itself. */
  className?: string
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const oldIdx = items.findIndex(i => i.id === active.id)
    const newIdx = items.findIndex(i => i.id === over.id)
    if (oldIdx < 0 || newIdx < 0) return
    onReorder(arrayMove(items, oldIdx, newIdx))
  }

  // When not editing, render plain — no DnD overhead.
  if (!editing) {
    return (
      <div className={className}>
        {items.map((item, idx) => (
          <div key={item.id} className={item.className}>
            {renderTile(item, idx)}
          </div>
        ))}
      </div>
    )
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter}
      modifiers={[restrictToParentElement]} onDragEnd={handleDragEnd}>
      <SortableContext items={items.map(i => i.id)} strategy={rectSortingStrategy}>
        <div className={className}>
          {items.map((item, idx) => (
            <SortableWrapper key={item.id} id={item.id} className={item.className}>
              {renderTile(item, idx)}
            </SortableWrapper>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}

function SortableWrapper({ id, className, children }: { id: string; className?: string; children: React.ReactNode }) {
  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging,
  } = useSortable({ id })

  const style: React.CSSProperties = {
    transform:  CSS.Transform.toString(transform),
    transition,
    opacity:    isDragging ? 0.5 : 1,
    zIndex:     isDragging ? 20  : undefined,
  }

  return (
    <div ref={setNodeRef} style={style} className={`relative ${className || ''}`}>
      <button
        type="button"
        aria-label="Drag to reorder"
        {...attributes}
        {...listeners}
        className="absolute top-1 left-1 sm:-top-2 sm:-left-2 z-20 w-6 h-6 rounded-full bg-surface-1 border border-surface-border shadow-md flex items-center justify-center cursor-grab active:cursor-grabbing text-surface-muted hover:text-brand-600 hover:border-brand-400 transition-colors touch-none">
        <GripVertical className="w-3.5 h-3.5" />
      </button>
      {children}
    </div>
  )
}
