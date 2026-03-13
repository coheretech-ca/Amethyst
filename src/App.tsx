/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Image as ImageIcon, 
  Plus, 
  Search, 
  X, 
  Maximize2, 
  Trash2, 
  Edit3, 
  Save,
  Grid,
  List as ListIcon,
  Calendar,
  Tag,
  ChevronLeft,
  ChevronRight,
  Info,
  Share2,
  Menu,
  ArrowLeft,
  Download,
  StickyNote,
  ZoomIn,
  ZoomOut,
  Crop,
  AlertCircle,
  Check,
  RefreshCw,
  Folder,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useDropzone } from 'react-dropzone';
import ReactMarkdown from 'react-markdown';
import { format } from 'date-fns';
import { v4 as uuidv4 } from 'uuid';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import * as d3 from 'd3';

import { get, set, del } from 'idb-keyval';

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface Photo {
  id: string;
  filename: string;
  mime_type: string;
  size: number;
  width: number;
  height: number;
  folder_id: string | null;
  created_at: string;
  updated_at: string;
  has_note: number;
  tag_count: number;
}

interface Folder {
  id: string;
  name: string;
  parent_id: string | null;
}

interface SmartAlbum {
  id: string;
  name: string;
  criteria: {
    tags?: string[];
    startDate?: string;
    endDate?: string;
  };
}

interface TagType {
  id: string;
  name: string;
}

export default function App() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [smartAlbums, setSmartAlbums] = useState<SmartAlbum[]>([]);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [currentSmartAlbumId, setCurrentSmartAlbumId] = useState<string | null>(null);
  const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null);
  const [photoTags, setPhotoTags] = useState<TagType[]>([]);
  const [newTagName, setNewTagName] = useState('');
  const [note, setNote] = useState<string>('');
  const [isEditingNote, setIsEditingNote] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ total: number, current: number, errors: string[] }>({ total: 0, current: 0, errors: [] });
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [isCreatingSmartAlbum, setIsCreatingSmartAlbum] = useState(false);
  const [newSmartAlbumName, setNewSmartAlbumName] = useState('');
  const [newSmartAlbumTags, setNewSmartAlbumTags] = useState('');
  const [newSmartAlbumStartDate, setNewSmartAlbumStartDate] = useState('');
  const [newSmartAlbumEndDate, setNewSmartAlbumEndDate] = useState('');
  const [showGraph, setShowGraph] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, photo?: Photo, folder?: Folder } | null>(null);
  const [isEditingFolder, setIsEditingFolder] = useState<Folder | null>(null);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const fetchPhotos = async () => {
    try {
      let url = new URL('/api/photos', window.location.origin);
      if (currentSmartAlbumId) {
        url = new URL(`/api/smart-albums/${currentSmartAlbumId}/photos`, window.location.origin);
      } else if (currentFolderId !== null) {
        url.searchParams.append('folder_id', currentFolderId);
      }
      if (searchQuery) {
        url.searchParams.append('q', searchQuery);
      }
      const res = await fetch(url.toString());
      const data = await res.json();
      setPhotos(data);
    } catch (err) {
      console.error('Failed to fetch photos', err);
    }
  };

  const fetchFolders = async () => {
    const res = await fetch('/api/folders');
    const data = await res.json();
    setFolders(data);
  };

  const fetchSmartAlbums = async () => {
    const res = await fetch('/api/smart-albums');
    const data = await res.json();
    setSmartAlbums(data);
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchPhotos();
    }, 300);
    return () => clearTimeout(timer);
  }, [currentFolderId, currentSmartAlbumId, searchQuery]);

  useEffect(() => {
    fetchFolders();
    fetchSmartAlbums();
  }, []);

  const fetchNote = async (photoId: string) => {
    try {
      const res = await fetch(`/api/photos/${photoId}/note`);
      const data = await res.json();
      setNote(data.content || '');
    } catch (err) {
      console.error('Failed to fetch note', err);
    }
  };

  const fetchPhotoTags = async (photoId: string) => {
    const res = await fetch(`/api/photos/${photoId}/tags`);
    const data = await res.json();
    setPhotoTags(data);
  };

  useEffect(() => {
    if (selectedPhoto) {
      fetchNote(selectedPhoto.id);
      fetchPhotoTags(selectedPhoto.id);
      setZoom(1);
    }
  }, [selectedPhoto]);

  const addTag = async () => {
    if (!selectedPhoto || !newTagName.trim()) return;
    const res = await fetch(`/api/photos/${selectedPhoto.id}/tags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newTagName.trim() })
    });
    if (res.ok) {
      fetchPhotoTags(selectedPhoto.id);
      setNewTagName('');
    }
  };

  const removeTag = async (tagId: string) => {
    if (!selectedPhoto) return;
    await fetch(`/api/photos/${selectedPhoto.id}/tags/${tagId}`, { method: 'DELETE' });
    fetchPhotoTags(selectedPhoto.id);
  };

  const createFolder = async () => {
    if (!newFolderName.trim()) return;
    await fetch('/api/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        id: uuidv4(), 
        name: newFolderName.trim(), 
        parent_id: currentFolderId 
      })
    });
    setNewFolderName('');
    setIsCreatingFolder(false);
    fetchFolders();
  };

  const updateFolderName = async (id: string, name: string) => {
    if (!name.trim()) return;
    await fetch(`/api/folders/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim() })
    });
    fetchFolders();
  };

  const deleteFolder = async (id: string) => {
    await fetch(`/api/folders/${id}`, { method: 'DELETE' });
    fetchFolders();
    fetchPhotos(); // Refresh photos as they might have been in that folder
  };

  const togglePhotoSelection = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setSelectedPhotoIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearSelection = () => setSelectedPhotoIds(new Set());

  const bulkDelete = async () => {
    const ids = Array.from(selectedPhotoIds);
    await fetch('/api/photos/bulk-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids })
    });
    for (const id of ids) {
      await del(`photo_${id}`);
    }
    clearSelection();
    fetchPhotos();
  };

  const bulkMove = async (folderId: string | null) => {
    const ids = Array.from(selectedPhotoIds);
    await fetch('/api/photos/bulk-move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, folder_id: folderId })
    });
    clearSelection();
    fetchPhotos();
  };

  const bulkAddTag = async (tagName: string) => {
    const ids = Array.from(selectedPhotoIds);
    await fetch('/api/photos/bulk-tag', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, name: tagName.trim() })
    });
    clearSelection();
    fetchPhotos();
  };

  const createSmartAlbum = async () => {
    if (!newSmartAlbumName.trim()) return;
    await fetch('/api/smart-albums', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: uuidv4(),
        name: newSmartAlbumName.trim(),
        criteria: {
          tags: newSmartAlbumTags.split(',').map(t => t.trim()).filter(t => t),
          startDate: newSmartAlbumStartDate || undefined,
          endDate: newSmartAlbumEndDate || undefined
        }
      })
    });
    setNewSmartAlbumName('');
    setNewSmartAlbumTags('');
    setNewSmartAlbumStartDate('');
    setNewSmartAlbumEndDate('');
    setIsCreatingSmartAlbum(false);
    fetchSmartAlbums();
  };

  const movePhotoToFolder = async (photoId: string, folderId: string | null) => {
    await fetch(`/api/photos/${photoId}/folder`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder_id: folderId })
    });
    fetchPhotos();
  };

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    setIsUploading(true);
    setUploadProgress({ total: acceptedFiles.length, current: 0, errors: [] });
    
    for (let i = 0; i < acceptedFiles.length; i++) {
      const file = acceptedFiles[i];
      try {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target?.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = reject;
          image.src = base64;
        });

        const photoData = {
          id: uuidv4(),
          filename: file.name,
          mime_type: file.type,
          size: file.size,
          width: img.width,
          height: img.height,
          folder_id: currentFolderId,
          content: ""
        };

        await set(`photo_${photoData.id}`, base64);

        const res = await fetch('/api/photos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(photoData)
        });

        if (!res.ok) throw new Error(`Server responded with ${res.status}`);
        
        setUploadProgress(prev => ({ ...prev, current: i + 1 }));
        fetchPhotos();
      } catch (err) {
        console.error('Upload failed', err);
        setUploadProgress(prev => ({ 
          ...prev, 
          current: i + 1,
          errors: [...prev.errors, `Failed to upload ${file.name}: ${err instanceof Error ? err.message : 'Unknown error'}`] 
        }));
      }
    }
    
    // Keep progress visible for a moment if there were errors
    setTimeout(() => {
      setIsUploading(false);
    }, 3000);
  }, [currentFolderId]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ 
    onDrop, 
    accept: { 'image/*': [] },
    noClick: true 
  });

  const handleContextMenu = (e: React.MouseEvent | React.TouchEvent, item: Photo | Folder) => {
    e.preventDefault();
    let x = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    let y = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    
    // Bounds checking
    const menuWidth = 192; // w-48 = 12rem = 192px
    const menuHeight = 250; // approximate
    if (x + menuWidth > window.innerWidth) x -= menuWidth;
    if (y + menuHeight > window.innerHeight) y -= menuHeight;

    if ('filename' in item) {
      setContextMenu({ x, y, photo: item });
    } else {
      setContextMenu({ x, y, folder: item });
    }
  };

  const closeContextMenu = () => setContextMenu(null);

  useEffect(() => {
    const handleClick = () => closeContextMenu();
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, []);

  const saveNote = async () => {
    if (!selectedPhoto) return;
    try {
      await fetch(`/api/photos/${selectedPhoto.id}/note`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: note })
      });
      setIsEditingNote(false);
    } catch (err) {
      console.error('Failed to save note', err);
    }
  };

  const deletePhoto = async (id: string) => {
    try {
      await fetch(`/api/photos/${id}`, { method: 'DELETE' });
      await del(`photo_${id}`);
      setSelectedPhoto(null);
      setIsDeleting(false);
      fetchPhotos();
    } catch (err) {
      console.error('Failed to delete photo', err);
    }
  };

  const resizePhoto = async (width: number, height: number) => {
    if (!selectedPhoto) return;
    setIsResizing(true);
    try {
      const base64 = await get(`photo_${selectedPhoto.id}`);
      if (!base64) return;

      const img = new Image();
      img.onload = async () => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, width, height);
        const resizedBase64 = canvas.toDataURL(selectedPhoto.mime_type);
        
        // Update local storage
        await set(`photo_${selectedPhoto.id}`, resizedBase64);
        
        // Update backend
        const res = await fetch(`/api/photos/${selectedPhoto.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            width,
            height,
            size: Math.round((resizedBase64.length * 3) / 4) // Approximate size in bytes
          })
        });
        
        if (res.ok) {
          const updatedPhoto = { ...selectedPhoto, width, height, size: Math.round((resizedBase64.length * 3) / 4) };
          setSelectedPhoto(updatedPhoto);
          fetchPhotos();
        }
        setIsResizing(false);
      };
      img.src = base64;
    } catch (err) {
      console.error('Failed to resize photo', err);
      setIsResizing(false);
    }
  };

  const filteredPhotos = photos; // Search is now handled by backend

  const currentFolder = folders.find(f => f.id === currentFolderId);
  const subFolders = folders.filter(f => f.parent_id === currentFolderId);

  const renderNote = (content: string) => {
    return content.replace(/\[\[(.*?)\]\]/g, (match, p1) => {
      return `[${p1}](#link-${p1})`;
    });
  };

  const handleNoteLinkClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'A' && target.getAttribute('href')?.startsWith('#link-')) {
      e.preventDefault();
      const targetName = target.getAttribute('href')?.replace('#link-', '');
      const targetPhoto = photos.find(p => p.filename === targetName || p.id === targetName);
      if (targetPhoto) {
        setSelectedPhoto(targetPhoto);
      }
    }
  };

  const renderFolderItems = (parentId: string | null = null, depth = 0): React.ReactNode => {
    return folders
      .filter(f => f.parent_id === parentId)
      .map(folder => (
        <React.Fragment key={folder.id}>
          <li>
            <button 
              onClick={() => { setCurrentFolderId(folder.id); setCurrentSmartAlbumId(null); setIsSidebarOpen(false); }}
              className={cn(
                "w-full text-left px-3 py-2 rounded-lg text-sm transition-all flex items-center gap-2",
                currentFolderId === folder.id ? "bg-black text-white" : "hover:bg-black/5"
              )}
              style={{ paddingLeft: `${(depth + 1) * 0.75}rem` }}
            >
              <Folder size={16} /> {folder.name}
            </button>
          </li>
          {renderFolderItems(folder.id, depth + 1)}
        </React.Fragment>
      ));
  };

  return (
    <div className="min-h-screen bg-[#F5F5F0] text-[#141414] font-sans selection:bg-black selection:text-white flex flex-col" {...getRootProps()}>
      <input {...getInputProps()} />
      
      {/* Navigation */}
      <nav className="sticky top-0 z-40 bg-[#F5F5F0]/80 backdrop-blur-md border-b border-black/5 px-4 md:px-6 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 md:gap-3">
          {isMobile && (
            <button onClick={() => setIsSidebarOpen(true)} className="p-2 hover:bg-black/5 rounded-full">
              <Menu size={20} />
            </button>
          )}
          <div className="w-8 h-8 md:w-10 md:h-10 bg-black rounded-full flex items-center justify-center text-white shrink-0">
            <ImageIcon size={isMobile ? 16 : 20} />
          </div>
          <h1 className="text-lg md:text-xl font-medium tracking-tight italic serif hidden sm:block">Lumina</h1>
        </div>

        <div className="flex-1 max-w-md relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-black/40" size={18} />
          <input 
            type="text"
            placeholder="Search filename, notes, tags..."
            className="w-full bg-black/5 border-none rounded-full py-2 pl-10 pr-4 focus:ring-2 focus:ring-black/10 transition-all outline-none text-sm"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="flex items-center gap-2 md:gap-4">
          {!isMobile && (
            <div className="flex bg-black/5 rounded-full p-1">
              <button 
                onClick={() => setViewMode('grid')}
                className={cn("p-1.5 rounded-full transition-all", viewMode === 'grid' ? "bg-white shadow-sm" : "opacity-50 hover:opacity-100")}
              >
                <Grid size={18} />
              </button>
              <button 
                onClick={() => setViewMode('list')}
                className={cn("p-1.5 rounded-full transition-all", viewMode === 'list' ? "bg-white shadow-sm" : "opacity-50 hover:opacity-100")}
              >
                <ListIcon size={18} />
              </button>
            </div>
          )}
          <label className="cursor-pointer bg-black text-white px-3 md:px-4 py-2 rounded-full flex items-center gap-2 hover:bg-black/80 transition-all text-sm">
            <Plus size={18} />
            <span className="hidden sm:inline">Upload</span>
            <input type="file" multiple className="hidden" onChange={(e) => onDrop(Array.from(e.target.files || []))} />
          </label>
        </div>
      </nav>

      <div className="flex flex-1 overflow-hidden relative">
        {/* Sidebar Overlay */}
        <AnimatePresence>
          {isMobile && isSidebarOpen && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsSidebarOpen(false)}
              className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40"
            />
          )}
        </AnimatePresence>

        {/* Sidebar */}
        <aside className={cn(
          "bg-white border-r border-black/5 p-6 flex flex-col gap-8 overflow-y-auto transition-all duration-300 z-50",
          isMobile ? "fixed inset-y-0 left-0 w-72 shadow-2xl" : "w-64",
          isMobile && !isSidebarOpen && "-translate-x-full"
        )}>
          {isMobile && (
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-medium italic serif">Lumina</h2>
              <button onClick={() => setIsSidebarOpen(false)} className="p-2 hover:bg-black/5 rounded-full">
                <X size={20} />
              </button>
            </div>
          )}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[10px] font-bold text-black/40 uppercase tracking-widest">Library</h3>
            </div>
            <ul className="space-y-1">
              <li>
                <button 
                  onClick={() => { setCurrentFolderId(null); setCurrentSmartAlbumId(null); setIsSidebarOpen(false); }}
                  className={cn("w-full text-left px-3 py-2 rounded-lg text-sm transition-all flex items-center gap-2", !currentFolderId && !currentSmartAlbumId ? "bg-black text-white" : "hover:bg-black/5")}
                >
                  <ImageIcon size={16} /> All Photos
                </button>
              </li>
              <li>
                <button 
                  onClick={() => { setShowGraph(true); setIsSidebarOpen(false); }}
                  className="w-full text-left px-3 py-2 rounded-lg text-sm transition-all flex items-center gap-2 hover:bg-black/5"
                >
                  <Share2 size={16} /> Graph View
                </button>
              </li>
            </ul>
          </div>

          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[10px] font-bold text-black/40 uppercase tracking-widest">Folders</h3>
              <button onClick={() => setIsCreatingFolder(true)} className="p-1 hover:bg-black/5 rounded-full transition-all">
                <Plus size={14} />
              </button>
            </div>
            {isCreatingFolder && (
              <div className="mb-4 flex gap-2">
                <input 
                  type="text" 
                  placeholder="Folder name" 
                  className="flex-1 text-xs border border-black/10 rounded-lg px-2 py-1 outline-none"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && createFolder()}
                />
                <button onClick={createFolder} className="bg-black text-white p-1 rounded-lg"><Plus size={14} /></button>
              </div>
            )}
            <ul className="space-y-1">
              {renderFolderItems(null)}
            </ul>
          </div>

          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[10px] font-bold text-black/40 uppercase tracking-widest">Smart Albums</h3>
              <button onClick={() => setIsCreatingSmartAlbum(true)} className="p-1 hover:bg-black/5 rounded-full transition-all">
                <Plus size={14} />
              </button>
            </div>
            {isCreatingSmartAlbum && (
              <div className="mb-4 flex flex-col gap-2">
                <input 
                  type="text" 
                  placeholder="Album name" 
                  className="text-xs border border-black/10 rounded-lg px-2 py-1 outline-none"
                  value={newSmartAlbumName}
                  onChange={(e) => setNewSmartAlbumName(e.target.value)}
                />
                <input 
                  type="text" 
                  placeholder="Tags (comma separated)" 
                  className="text-xs border border-black/10 rounded-lg px-2 py-1 outline-none"
                  value={newSmartAlbumTags}
                  onChange={(e) => setNewSmartAlbumTags(e.target.value)}
                />
                <div className="flex gap-2">
                  <input 
                    type="date" 
                    className="text-[10px] border border-black/10 rounded-lg px-2 py-1 outline-none flex-1"
                    value={newSmartAlbumStartDate}
                    onChange={(e) => setNewSmartAlbumStartDate(e.target.value)}
                  />
                  <input 
                    type="date" 
                    className="text-[10px] border border-black/10 rounded-lg px-2 py-1 outline-none flex-1"
                    value={newSmartAlbumEndDate}
                    onChange={(e) => setNewSmartAlbumEndDate(e.target.value)}
                  />
                </div>
                <button onClick={createSmartAlbum} className="bg-black text-white py-1 rounded-lg text-xs">Create Album</button>
              </div>
            )}
            <ul className="space-y-1">
              {smartAlbums.map(album => (
                <li key={album.id}>
                  <button 
                    onClick={() => { setCurrentSmartAlbumId(album.id); setCurrentFolderId(null); }}
                    className={cn("w-full text-left px-3 py-2 rounded-lg text-sm transition-all flex items-center gap-2", currentSmartAlbumId === album.id ? "bg-black text-white" : "hover:bg-black/5")}
                  >
                    <ImageIcon size={16} /> {album.name}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 p-6 overflow-y-auto">
          {isDragActive && (
            <div className="fixed inset-0 z-50 bg-black/20 backdrop-blur-sm flex items-center justify-center border-4 border-dashed border-black m-4 rounded-3xl">
              <div className="text-center">
                <Plus size={48} className="mx-auto mb-4 animate-bounce" />
                <p className="text-2xl font-medium">Drop to add to your gallery</p>
              </div>
            </div>
          )}

          <div className="mb-8 flex items-center justify-between">
            <div>
              <h2 className="text-3xl font-medium tracking-tight italic serif">
                {currentSmartAlbumId ? smartAlbums.find(a => a.id === currentSmartAlbumId)?.name : (currentFolder ? currentFolder.name : "All Photos")}
              </h2>
              <div className="flex items-center gap-2 mt-2 text-sm text-black/40">
                {currentFolderId && (
                  <button onClick={() => setCurrentFolderId(currentFolder?.parent_id || null)} className="hover:text-black flex items-center gap-1 transition-all">
                    <ChevronLeft size={14} /> Back
                  </button>
                )}
                <span>{filteredPhotos.length} items</span>
                {filteredPhotos.length > 0 && (
                  <>
                    <span className="w-1 h-1 bg-black/10 rounded-full" />
                    <button 
                      onClick={() => {
                        if (selectedPhotoIds.size === filteredPhotos.length) clearSelection();
                        else setSelectedPhotoIds(new Set(filteredPhotos.map(p => p.id)));
                      }}
                      className="hover:text-black transition-all"
                    >
                      {selectedPhotoIds.size === filteredPhotos.length ? "Deselect All" : "Select All"}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Subfolders Grid */}
          {subFolders.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-12">
              {subFolders.map(folder => (
                <motion.div
                  key={folder.id}
                  className="relative group"
                >
                  <LongPressWrapper onLongPress={(e) => handleContextMenu(e as any, folder)}>
                    <button 
                      onClick={() => setCurrentFolderId(folder.id)}
                      onContextMenu={(e) => handleContextMenu(e, folder)}
                      className="w-full bg-white border border-black/5 p-4 rounded-2xl flex flex-col items-center gap-2 hover:shadow-lg transition-all"
                    >
                      <Folder size={32} className="text-black/20" />
                      <span className="text-sm font-medium">{folder.name}</span>
                    </button>
                  </LongPressWrapper>
                </motion.div>
              ))}
            </div>
          )}

          {filteredPhotos.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-32 text-black/30">
              <ImageIcon size={64} strokeWidth={1} />
              <p className="mt-4 text-lg italic serif">This view is empty.</p>
            </div>
          ) : (
            <div className={cn(
              "gap-6",
              viewMode === 'grid' ? "grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" : "flex flex-col"
            )}>
              {filteredPhotos.map((photo) => (
                <motion.div
                  layoutId={photo.id}
                  key={photo.id}
                  onClick={(e) => {
                    if (selectedPhotoIds.size > 0 || e.metaKey || e.ctrlKey) {
                      togglePhotoSelection(photo.id, e);
                    } else {
                      setSelectedPhoto(photo);
                    }
                  }}
                  onContextMenu={(e) => handleContextMenu(e, photo)}
                  className={cn(
                    "group relative cursor-pointer overflow-hidden rounded-2xl transition-all hover:shadow-xl",
                    viewMode === 'grid' ? "aspect-square bg-black/5" : "flex items-center gap-6 p-4 bg-white border border-black/5",
                    selectedPhotoIds.has(photo.id) ? "ring-2 ring-black border-transparent scale-[0.98]" : "hover:-translate-y-1"
                  )}
                >
                  <div 
                    onClick={(e) => togglePhotoSelection(photo.id, e)}
                    className={cn(
                      "absolute top-3 left-3 z-20 w-5 h-5 rounded-full border-2 transition-all flex items-center justify-center",
                      selectedPhotoIds.has(photo.id) 
                        ? "bg-black border-black text-white" 
                        : "bg-white/50 border-white opacity-0 group-hover:opacity-100"
                    )}
                  >
                    {selectedPhotoIds.has(photo.id) && <Check size={12} strokeWidth={3} />}
                  </div>

                  {/* Indicators */}
                  <div className="absolute top-3 right-3 z-20 flex gap-1.5">
                    {photo.has_note > 0 && (
                      <div className="bg-white/90 backdrop-blur-sm p-1.5 rounded-full shadow-sm text-black/60" title="Has notes">
                        <StickyNote size={12} />
                      </div>
                    )}
                    {photo.tag_count > 0 && (
                      <div className="bg-white/90 backdrop-blur-sm p-1.5 rounded-full shadow-sm text-black/60" title={`${photo.tag_count} tags`}>
                        <Tag size={12} />
                      </div>
                    )}
                  </div>

                  <LongPressWrapper onLongPress={(e) => handleContextMenu(e as any, photo)}>
                    <div className={cn(
                      "relative overflow-hidden bg-black/5",
                      viewMode === 'grid' ? "aspect-square" : "w-24 h-24 rounded-lg flex-shrink-0"
                    )}>
                      <Thumbnail 
                        photoId={photo.id}
                        alt={photo.filename}
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                      
                      {/* Grid Overlay */}
                      {viewMode === 'grid' && (
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-4">
                          <p className="text-white text-xs font-medium truncate">{photo.filename}</p>
                          <div className="flex items-center justify-between mt-1">
                            <p className="text-white/60 text-[10px]">{format(new Date(photo.created_at), 'MMM d, yyyy')}</p>
                            {photo.folder_id && !currentFolderId && (
                              <span className="text-[9px] bg-white/20 backdrop-blur-md px-1.5 py-0.5 rounded-full text-white flex items-center gap-1">
                                <Folder size={8} />
                                {folders.find(f => f.id === photo.folder_id)?.name}
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </LongPressWrapper>

                  {viewMode === 'list' && (
                    <div className="flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium truncate">{photo.filename}</p>
                        {photo.folder_id && !currentFolderId && (
                          <span className="text-[10px] bg-black/5 px-2 py-0.5 rounded-full text-black/40 flex items-center gap-1">
                            <Folder size={8} />
                            {folders.find(f => f.id === photo.folder_id)?.name}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-black/40 mt-1">
                        {format(new Date(photo.created_at), 'MMM d, yyyy')}
                      </p>
                    </div>
                  )}
                </motion.div>
              ))}
            </div>
          )}
        </main>
      </div>

      {/* Graph View Overlay */}
      <AnimatePresence>
        {showGraph && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="fixed inset-0 z-[60] bg-[#F5F5F0] flex flex-col"
          >
            <div className="p-4 border-b border-black/5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Share2 size={20} />
                <h2 className="text-xl font-medium italic serif">Knowledge Graph</h2>
              </div>
              <button onClick={() => setShowGraph(false)} className="p-2 hover:bg-black/5 rounded-full">
                <X size={24} />
              </button>
            </div>
            <div className="flex-1 relative overflow-hidden">
              <GraphView onPhotoSelect={(photo) => { setSelectedPhoto(photo); setShowGraph(false); }} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Detail Overlay */}
      <AnimatePresence>
        {selectedPhoto && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-[#F5F5F0]/95 backdrop-blur-xl overflow-y-auto md:overflow-hidden"
          >
            <div className="w-full min-h-full md:h-full max-w-7xl flex flex-col md:flex-row relative">
              {/* Close Button */}
              <button 
                onClick={() => setSelectedPhoto(null)}
                className="fixed top-4 right-4 z-[70] p-3 rounded-full bg-white/80 backdrop-blur shadow-xl hover:bg-white transition-all md:absolute md:top-6 md:right-6"
                aria-label="Close"
              >
                <X size={24} />
              </button>

              {/* Photo View */}
              <div className="w-full h-[60vh] md:h-full md:flex-[2] flex flex-col min-h-0 p-4 md:p-8">
                <motion.div 
                  drag="y"
                  dragConstraints={{ top: 0, bottom: 0 }}
                  onDragEnd={(_, info) => {
                    if (info.offset.y > 150) setSelectedPhoto(null);
                  }}
                  className="flex-1 relative rounded-3xl overflow-hidden bg-black/5 flex items-center justify-center group cursor-zoom-in"
                >
                  <Thumbnail 
                    photoId={selectedPhoto.id}
                    alt={selectedPhoto.filename}
                    className="max-w-full max-h-full object-contain transition-transform duration-300 pointer-events-none"
                    style={{ transform: `scale(${zoom})` } as any}
                  />
                  
                  {/* Zoom Controls */}
                  <div className="absolute top-4 right-4 flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-all">
                    <button 
                      onClick={() => setZoom(prev => Math.min(prev + 0.5, 5))}
                      className="bg-white/90 backdrop-blur p-2 rounded-full shadow-lg hover:bg-white text-black"
                      title="Zoom In"
                    >
                      <ZoomIn size={18} />
                    </button>
                    <button 
                      onClick={() => setZoom(prev => Math.max(prev - 0.5, 0.5))}
                      className="bg-white/90 backdrop-blur p-2 rounded-full shadow-lg hover:bg-white text-black"
                      title="Zoom Out"
                    >
                      <ZoomOut size={18} />
                    </button>
                    <button 
                      onClick={() => setZoom(1)}
                      className="bg-white/90 backdrop-blur p-2 rounded-full shadow-lg hover:bg-white text-black text-[10px] font-bold"
                      title="Reset Zoom"
                    >
                      1:1
                    </button>
                  </div>

                  <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-all">
                    <div className="relative group/resize">
                      <button className="bg-white/90 backdrop-blur p-2 rounded-full shadow-lg hover:bg-white text-black flex items-center gap-1">
                        <Crop size={18} />
                        {isResizing && <RefreshCw size={12} className="animate-spin" />}
                      </button>
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-white border border-black/5 rounded-xl shadow-xl p-2 hidden group-hover/resize:block w-32 z-50">
                        <p className="text-[10px] font-bold text-black/40 uppercase tracking-widest mb-2 px-2">Resize to</p>
                        <button onClick={() => resizePhoto(100, 100)} className="w-full text-left px-3 py-1.5 rounded-lg hover:bg-black/5 text-xs">100 x 100</button>
                        <button onClick={() => resizePhoto(200, 200)} className="w-full text-left px-3 py-1.5 rounded-lg hover:bg-black/5 text-xs">200 x 200</button>
                        <button onClick={() => resizePhoto(800, 600)} className="w-full text-left px-3 py-1.5 rounded-lg hover:bg-black/5 text-xs">800 x 600</button>
                      </div>
                    </div>
                    <button 
                      onClick={() => setIsDeleting(true)}
                      className="bg-red-500/90 backdrop-blur p-2 rounded-full shadow-lg text-white hover:bg-red-500"
                      title="Delete Photo"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>

                  {/* Delete Confirmation Overlay */}
                  <AnimatePresence>
                    {isDeleting && (
                      <motion.div 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 z-10 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6"
                      >
                        <motion.div 
                          initial={{ scale: 0.9, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          className="bg-white rounded-3xl p-8 max-w-sm w-full text-center shadow-2xl"
                        >
                          <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
                            <AlertCircle size={32} />
                          </div>
                          <h3 className="text-xl font-medium mb-2">Delete Photo?</h3>
                          <p className="text-sm text-black/40 mb-8">This action cannot be undone. This memory will be removed from your gallery.</p>
                          <div className="flex gap-3">
                            <button 
                              onClick={() => setIsDeleting(false)}
                              className="flex-1 px-4 py-2 rounded-xl border border-black/5 hover:bg-black/5 transition-all text-sm font-medium"
                            >
                              Cancel
                            </button>
                            <button 
                              onClick={() => deletePhoto(selectedPhoto.id)}
                              className="flex-1 px-4 py-2 rounded-xl bg-red-600 text-white hover:bg-red-700 transition-all text-sm font-medium"
                            >
                              Delete
                            </button>
                          </div>
                        </motion.div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
                <div className="mt-4 flex items-center justify-between px-2">
                  <div>
                    <h2 className="text-xl font-medium">{selectedPhoto.filename}</h2>
                    <p className="text-sm text-black/40 flex items-center gap-2">
                      <Calendar size={14} />
                      {format(new Date(selectedPhoto.created_at), 'MMMM d, yyyy • HH:mm')}
                    </p>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-black/40">
                    <div className="relative group/move">
                      <button className="flex items-center gap-1 hover:text-black">
                        <Folder size={14} /> Move to
                      </button>
                      <div className="absolute bottom-full left-0 mb-2 bg-white border border-black/5 rounded-xl shadow-xl p-2 hidden group-hover/move:block w-48 z-50">
                        <button onClick={() => movePhotoToFolder(selectedPhoto.id, null)} className="w-full text-left px-3 py-2 rounded-lg hover:bg-black/5 text-xs">Root</button>
                        {folders.map(f => (
                          <button key={f.id} onClick={() => movePhotoToFolder(selectedPhoto.id, f.id)} className="w-full text-left px-3 py-2 rounded-lg hover:bg-black/5 text-xs">{f.name}</button>
                        ))}
                      </div>
                    </div>
                    <span className="flex items-center gap-1"><Info size={14} /> {selectedPhoto.width}x{selectedPhoto.height}</span>
                    <span>{(selectedPhoto.size / 1024 / 1024).toFixed(2)} MB</span>
                  </div>
                </div>
              </div>

              {/* Notes Panel (Obsidian Style) */}
              <div className="w-full md:w-[400px] flex flex-col bg-white rounded-3xl border border-black/5 shadow-2xl overflow-hidden">
                <div className="p-4 border-b border-black/5 flex items-center justify-between bg-black/5">
                  <div className="flex items-center gap-2">
                    <Edit3 size={16} />
                    <span className="font-medium text-sm">Description (Markdown)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {isEditingNote ? (
                      <button 
                        onClick={saveNote}
                        className="flex items-center gap-1 bg-black text-white px-3 py-1 rounded-lg text-xs hover:bg-black/80 transition-all"
                      >
                        <Save size={14} />
                        Save
                      </button>
                    ) : (
                      <button 
                        onClick={() => setIsEditingNote(true)}
                        className="p-1.5 rounded-lg hover:bg-black/5 transition-all"
                      >
                        <Edit3 size={18} />
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-6" onClick={handleNoteLinkClick}>
                  {isEditingNote ? (
                    <textarea 
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Write your thoughts, markdown supported..."
                      className="w-full h-full resize-none outline-none font-mono text-sm leading-relaxed"
                      autoFocus
                    />
                  ) : (
                    <div className="prose prose-sm max-w-none">
                      {note ? (
                        <ReactMarkdown>{renderNote(note)}</ReactMarkdown>
                      ) : (
                        <p className="text-black/30 italic">No description yet. Click edit to add context to this memory.</p>
                      )}
                    </div>
                  )}
                </div>

                <div className="p-4 bg-black/5 border-top border-black/5">
                  <div className="flex flex-wrap gap-2 mb-4">
                    <span className="text-[10px] font-bold text-black/40 uppercase tracking-widest flex items-center gap-1 w-full mb-1">
                      <Tag size={10} /> Tags
                    </span>
                    {photoTags.map(tag => (
                      <span key={tag.id} className="text-[10px] bg-white border border-black/5 px-2 py-1 rounded-full flex items-center gap-1">
                        #{tag.name}
                        <button onClick={() => removeTag(tag.id)} className="hover:text-red-500"><X size={10} /></button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input 
                      type="text" 
                      placeholder="Add tag..." 
                      className="flex-1 text-xs border border-black/10 rounded-lg px-2 py-1 outline-none"
                      value={newTagName}
                      onChange={(e) => setNewTagName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && addTag()}
                    />
                    <button onClick={addTag} className="bg-black text-white p-1 rounded-lg"><Plus size={14} /></button>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bulk Action Bar */}
      <AnimatePresence>
        {selectedPhotoIds.size > 0 && (
          <motion.div 
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[80] bg-black text-white px-4 md:px-6 py-4 rounded-3xl shadow-2xl flex items-center gap-4 md:gap-8 backdrop-blur-xl bg-black/90 w-[calc(100%-2rem)] md:w-auto max-w-2xl"
          >
            <div className="flex items-center gap-2 md:gap-4 pr-4 md:pr-8 border-r border-white/10 shrink-0">
              <button onClick={clearSelection} className="p-1 hover:bg-white/10 rounded-full">
                <X size={20} />
              </button>
              <span className="text-sm font-bold">{selectedPhotoIds.size} selected</span>
            </div>

            <div className="flex items-center gap-6">
              <div className="relative group/bulk-move">
                <button className="flex items-center gap-2 text-sm font-medium hover:text-white/70 transition-all">
                  <Folder size={18} />
                  <span>Move</span>
                </button>
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-4 bg-white text-black border border-black/5 rounded-2xl shadow-2xl p-2 hidden group-hover/bulk-move:block w-48 z-[90]">
                  <p className="text-[10px] font-bold text-black/40 uppercase tracking-widest mb-2 px-2">Move to</p>
                  <button onClick={() => bulkMove(null)} className="w-full text-left px-3 py-2 rounded-xl hover:bg-black/5 text-sm">Root</button>
                  {folders.map(f => (
                    <button key={f.id} onClick={() => bulkMove(f.id)} className="w-full text-left px-3 py-2 rounded-xl hover:bg-black/5 text-sm">{f.name}</button>
                  ))}
                </div>
              </div>

              <div className="relative group/bulk-tag">
                <button className="flex items-center gap-2 text-sm font-medium hover:text-white/70 transition-all">
                  <Tag size={18} />
                  <span>Tag</span>
                </button>
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-4 bg-white text-black border border-black/5 rounded-2xl shadow-2xl p-4 hidden group-hover/bulk-tag:block w-64 z-[90]">
                  <p className="text-[10px] font-bold text-black/40 uppercase tracking-widest mb-2">Add tag to all</p>
                  <div className="flex gap-2">
                    <input 
                      type="text" 
                      placeholder="Tag name..." 
                      className="flex-1 text-xs border border-black/10 rounded-lg px-2 py-1 outline-none"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          bulkAddTag(e.currentTarget.value);
                          e.currentTarget.value = '';
                        }
                      }}
                    />
                  </div>
                </div>
              </div>

              <button 
                onClick={bulkDelete}
                className="flex items-center gap-2 text-sm font-medium text-red-400 hover:text-red-300 transition-all"
              >
                <Trash2 size={18} />
                <span>Delete</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isUploading && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-6 right-6 z-[100] bg-white border border-black/5 rounded-2xl shadow-2xl p-4 w-80 overflow-hidden"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                <span className="text-xs font-bold uppercase tracking-widest text-black/40">Uploading Memories</span>
              </div>
              <span className="text-xs font-mono text-black/40">
                {uploadProgress.current} / {uploadProgress.total}
              </span>
            </div>
            
            <div className="w-full h-1 bg-black/5 rounded-full overflow-hidden mb-3">
              <motion.div 
                initial={{ width: 0 }}
                animate={{ width: `${(uploadProgress.current / uploadProgress.total) * 100}%` }}
                className="h-full bg-black"
              />
            </div>

            {uploadProgress.errors.length > 0 && (
              <div className="mt-3 pt-3 border-t border-black/5 max-h-32 overflow-y-auto">
                <p className="text-[10px] font-bold text-red-500 uppercase tracking-widest mb-1">Errors</p>
                {uploadProgress.errors.map((error, idx) => (
                  <p key={idx} className="text-[10px] text-red-400 mb-1 leading-tight">{error}</p>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Context Menu */}
      <AnimatePresence>
        {contextMenu && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            style={{ top: contextMenu.y, left: contextMenu.x }}
            className="fixed z-[100] bg-white border border-black/5 rounded-2xl shadow-2xl p-2 w-48 overflow-hidden"
          >
            {contextMenu.photo && (
              <>
                <div className="px-3 py-2 border-b border-black/5 mb-1">
                  <p className="text-[10px] font-bold text-black/30 uppercase tracking-widest truncate">{contextMenu.photo.filename}</p>
                </div>
                <button 
                  onClick={() => { setSelectedPhoto(contextMenu.photo!); closeContextMenu(); }}
                  className="w-full text-left px-3 py-2 rounded-xl hover:bg-black/5 text-sm flex items-center gap-2"
                >
                  <Maximize2 size={14} /> View Full
                </button>
                <button 
                  onClick={() => { setSelectedPhoto(contextMenu.photo!); setIsEditingNote(true); closeContextMenu(); }}
                  className="w-full text-left px-3 py-2 rounded-xl hover:bg-black/5 text-sm flex items-center gap-2"
                >
                  <Tag size={14} /> Add Tag / Note
                </button>
                <div className="relative group/move">
                  <button className="w-full text-left px-3 py-2 rounded-xl hover:bg-black/5 text-sm flex items-center gap-2">
                    <Folder size={14} /> Move to...
                  </button>
                  <div className="absolute left-full top-0 ml-1 bg-white border border-black/5 rounded-2xl shadow-2xl p-2 hidden group-hover:block w-48">
                    <button 
                      onClick={() => { movePhotoToFolder(contextMenu.photo!.id, null); closeContextMenu(); }}
                      className="w-full text-left px-3 py-2 rounded-xl hover:bg-black/5 text-sm"
                    >
                      Root
                    </button>
                    {folders.map(f => (
                      <button 
                        key={f.id}
                        onClick={() => { movePhotoToFolder(contextMenu.photo!.id, f.id); closeContextMenu(); }}
                        className="w-full text-left px-3 py-2 rounded-xl hover:bg-black/5 text-sm"
                      >
                        {f.name}
                      </button>
                    ))}
                  </div>
                </div>
                <button 
                  onClick={() => { setIsDeleting(true); setSelectedPhoto(contextMenu.photo!); closeContextMenu(); }}
                  className="w-full text-left px-3 py-2 rounded-xl hover:bg-red-50 text-red-500 text-sm flex items-center gap-2"
                >
                  <Trash2 size={14} /> Delete
                </button>
              </>
            )}

            {contextMenu.folder && (
              <>
                <div className="px-3 py-2 border-b border-black/5 mb-1">
                  <p className="text-[10px] font-bold text-black/30 uppercase tracking-widest truncate">{contextMenu.folder.name}</p>
                </div>
                <button 
                  onClick={() => { setIsEditingFolder(contextMenu.folder!); closeContextMenu(); }}
                  className="w-full text-left px-3 py-2 rounded-xl hover:bg-black/5 text-sm flex items-center gap-2"
                >
                  <Edit3 size={14} /> Rename
                </button>
                <button 
                  onClick={() => { 
                    deleteFolder(contextMenu.folder!.id);
                    closeContextMenu(); 
                  }}
                  className="w-full text-left px-3 py-2 rounded-xl hover:bg-red-50 text-red-500 text-sm flex items-center gap-2"
                >
                  <Trash2 size={14} /> Delete
                </button>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Folder Edit Modal */}
      <AnimatePresence>
        {isEditingFolder && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-6 bg-black/40 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl"
            >
              <h3 className="text-xl font-medium mb-4">Rename Folder</h3>
              <input 
                autoFocus
                type="text" 
                defaultValue={isEditingFolder.name}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    updateFolderName(isEditingFolder.id, e.currentTarget.value);
                    setIsEditingFolder(null);
                  }
                  if (e.key === 'Escape') setIsEditingFolder(null);
                }}
                className="w-full px-4 py-2 rounded-xl border border-black/10 outline-none focus:border-black transition-all mb-6"
              />
              <div className="flex gap-3">
                <button 
                  onClick={() => setIsEditingFolder(null)}
                  className="flex-1 px-4 py-2 rounded-xl border border-black/5 hover:bg-black/5 transition-all text-sm font-medium"
                >
                  Cancel
                </button>
                <button 
                  onClick={(e) => {
                    const input = e.currentTarget.parentElement?.previousElementSibling as HTMLInputElement;
                    updateFolderName(isEditingFolder.id, input.value);
                    setIsEditingFolder(null);
                  }}
                  className="flex-1 px-4 py-2 rounded-xl bg-black text-white hover:bg-black/80 transition-all text-sm font-medium"
                >
                  Save
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function LongPressWrapper({ children, onLongPress }: { children: React.ReactNode, onLongPress: (e: any) => void }) {
  const timerRef = useRef<any>(null);

  const start = (e: any) => {
    timerRef.current = setTimeout(() => {
      onLongPress(e);
    }, 500);
  };

  const stop = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  };

  return (
    <div 
      onMouseDown={start} 
      onMouseUp={stop} 
      onMouseLeave={stop}
      onTouchStart={start}
      onTouchEnd={stop}
      className="w-full h-full"
    >
      {children}
    </div>
  );
}

function Thumbnail({ photoId, className, alt, style }: { photoId: string, className?: string, alt?: string, style?: React.CSSProperties }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    get(`photo_${photoId}`).then(data => {
      if (data) setSrc(data);
    });
  }, [photoId]);

  if (!src) return <div className={cn("bg-black/5 animate-pulse", className)} style={style} />;

  return (
    <img 
      src={src} 
      alt={alt} 
      className={className} 
      style={style}
      referrerPolicy="no-referrer"
    />
  );
}


function GraphNodeImage({ photoId }: { photoId: string }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    get(`photo_${photoId}`).then(data => {
      if (data) setSrc(data);
    });
  }, [photoId]);

  if (!src) return null;

  return (
    <image 
      xlinkHref={src}
      x={-28}
      y={-28}
      width={56}
      height={56}
      clipPath={`url(#clip-${photoId})`}
      preserveAspectRatio="xMidYMid slice"
    />
  );
}

function GraphView({ onPhotoSelect }: { onPhotoSelect: (photo: any) => void }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [data, setData] = useState<{ nodes: any[], links: any[] }>({ nodes: [], links: [] });

  useEffect(() => {
    fetch('/api/graph')
      .then(res => res.json())
      .then(setData);
  }, []);

  useEffect(() => {
    if (!svgRef.current || data.nodes.length === 0) return;

    const width = window.innerWidth;
    const height = window.innerHeight - 64;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const simulation = d3.forceSimulation(data.nodes)
      .force("link", d3.forceLink(data.links).id((d: any) => d.id).distance(100))
      .force("charge", d3.forceManyBody().strength(-300))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide().radius(50));

    const g = svg.append("g");

    svg.call(d3.zoom()
      .scaleExtent([0.1, 4])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
      }) as any);

    const link = g.append("g")
      .selectAll("line")
      .data(data.links)
      .join("line")
      .attr("stroke", "#141414")
      .attr("stroke-opacity", 0.1)
      .attr("stroke-width", 1);

    const node = g.append("g")
      .selectAll("g")
      .data(data.nodes)
      .join("g")
      .call(d3.drag()
        .on("start", dragstarted)
        .on("drag", dragged)
        .on("end", dragended) as any)
      .on("click", (event, d: any) => {
        if (d.type === 'photo') {
          onPhotoSelect(d.photo);
        }
      });

    node.append("circle")
      .attr("r", (d: any) => d.type === 'photo' ? 30 : 20)
      .attr("fill", (d: any) => d.type === 'photo' ? "#fff" : "#141414")
      .attr("stroke", "#141414")
      .attr("stroke-width", 1)
      .attr("class", "cursor-pointer transition-all hover:stroke-[3px]");

    node.filter((d: any) => d.type === 'photo')
      .append("clipPath")
      .attr("id", (d: any) => `clip-${d.id}`)
      .append("circle")
      .attr("r", 28);

    node.filter((d: any) => d.type === 'photo')
      .append("image")
      .attr("x", -28)
      .attr("y", -28)
      .attr("width", 56)
      .attr("height", 56)
      .attr("clip-path", (d: any) => `url(#clip-${d.id})`)
      .attr("preserveAspectRatio", "xMidYMid slice")
      .each(function(d: any) {
        const img = d3.select(this);
        get(`photo_${d.id}`).then(src => {
          if (src) img.attr("xlink:href", src);
        });
      });

    node.append("text")
      .text((d: any) => d.name)
      .attr("dy", (d: any) => d.type === 'photo' ? 45 : 35)
      .attr("text-anchor", "middle")
      .attr("font-size", "10px")
      .attr("font-weight", "500")
      .attr("fill", "#141414")
      .attr("class", "pointer-events-none select-none");

    simulation.on("tick", () => {
      link
        .attr("x1", (d: any) => d.source.x)
        .attr("y1", (d: any) => d.source.y)
        .attr("x2", (d: any) => d.target.x)
        .attr("y2", (d: any) => d.target.y);

      node.attr("transform", (d: any) => `translate(${d.x},${d.y})`);
    });

    function dragstarted(event: any) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      event.subject.fx = event.subject.x;
      event.subject.fy = event.subject.y;
    }

    function dragged(event: any) {
      event.subject.fx = event.x;
      event.subject.fy = event.y;
    }

    function dragended(event: any) {
      if (!event.active) simulation.alphaTarget(0);
      event.subject.fx = null;
      event.subject.fy = null;
    }

    return () => { simulation.stop(); };
  }, [data]);

  return (
    <svg 
      ref={svgRef} 
      className="w-full h-full cursor-grab active:cursor-grabbing"
    />
  );
}
