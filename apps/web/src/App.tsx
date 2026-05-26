import type { BootstrapStatus, Business, GalleryMediaAsset, MediaCategory, MediaSelection, MenuItem } from "@fbmaniaco/shared";
import { useEffect, useMemo, useState } from "react";
import {
  archiveMediaAsset,
  consumeSelection,
  createMediaCategory,
  createSelection,
  getBootstrapStatus,
  listActiveSelections,
  listBusinesses,
  listMediaAssets,
  listMediaCategories,
  listMenuItems,
  ingestMenuText,
  updateMediaAsset,
  updateSelection,
  uploadMediaAsset,
  WebApiError
} from "./api/client";
import {
  clearWebSession,
  ensureFreshWebSession,
  readWebSession,
  signInWithPassword,
  startAnonymousWebSession,
  type WebSession
} from "./auth/session";
import { getWebConfig } from "./config";
import { connectGalleryPowerSync, isPowerSyncConfigured } from "./data/powersync";
import { getImageDimensions, sha256OfFile } from "./data/crypto";
import { categoryName, emptyFilters, filterAssetsLocally, nextSelectionAssetIds, type GalleryFilters } from "./data/gallery";

type AppState = {
  session: WebSession | null;
  bootstrap: BootstrapStatus | null;
  businesses: Business[];
  assets: GalleryMediaAsset[];
  categories: MediaCategory[];
  menuItems: MenuItem[];
  selection: MediaSelection | null;
  activeAsset: GalleryMediaAsset | null;
  filters: GalleryFilters;
  loading: boolean;
  syncMode: "rest" | "powersync";
  message: string | null;
  error: string | null;
};

const initialState = (): AppState => ({
  session: null,
  bootstrap: null,
  businesses: [],
  assets: [],
  categories: [],
  menuItems: [],
  selection: null,
  activeAsset: null,
  filters: emptyFilters(),
  loading: true,
  syncMode: "rest",
  message: null,
  error: null
});

const friendlyError = (error: unknown) => {
  if (error instanceof WebApiError) return error.userMessage ?? error.message;
  return error instanceof Error ? error.message : "Paso algo inesperado.";
};

export const App = () => {
  const [state, setState] = useState<AppState>(initialState);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [uploading, setUploading] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [menuText, setMenuText] = useState("");
  const [importingMenu, setImportingMenu] = useState(false);

  const workspace = state.bootstrap?.workspace ?? null;
  const activeBusiness = state.businesses[0] ?? null;
  const filteredAssets = useMemo(() => filterAssetsLocally(state.assets, state.filters), [state.assets, state.filters]);
  const selectedIds = state.selection?.assetIds ?? [];
  const config = getWebConfig();

  const setPatch = (patch: Partial<AppState>) => setState((current) => ({ ...current, ...patch }));

  const refreshGallery = async (session = state.session, bootstrap = state.bootstrap) => {
    if (!session?.accessToken || !bootstrap?.workspace?.id) return;
    const token = session.accessToken;
    const workspaceId = bootstrap.workspace.id;
    const assetQuery: Parameters<typeof listMediaAssets>[1] = {
      workspaceId,
      sort: state.filters.sort,
      limit: 200
    };
    if (state.filters.search) assetQuery.search = state.filters.search;
    if (state.filters.categoryId) assetQuery.categoryId = state.filters.categoryId;
    if (state.filters.unused) assetQuery.unused = true;
    if (state.filters.archived) assetQuery.archived = true;
    const [businesses, assetsResponse, categories, selections, menuItems] = await Promise.all([
      listBusinesses(token),
      listMediaAssets(token, assetQuery),
      listMediaCategories(token, workspaceId),
      listActiveSelections(token, workspaceId),
      listMenuItems(token, workspaceId)
    ]);
    setPatch({
      businesses,
      assets: assetsResponse.items,
      categories,
      menuItems,
      selection: selections[0] ?? null,
      error: null
    });
  };

  const bootstrapSession = async (session: WebSession) => {
    setPatch({ loading: true, error: null });
    try {
      const fresh = await ensureFreshWebSession(session);
      const bootstrap = await getBootstrapStatus(fresh.accessToken);
      const connected = await connectGalleryPowerSync();
      setPatch({ session: fresh, bootstrap, syncMode: connected ? "powersync" : "rest" });
      await refreshGallery(fresh, bootstrap);
    } catch (error) {
      clearWebSession();
      setPatch({ session: null, bootstrap: null, error: friendlyError(error) });
    } finally {
      setPatch({ loading: false });
    }
  };

  useEffect(() => {
    const existing = readWebSession();
    if (existing) void bootstrapSession(existing);
    else setPatch({ loading: false });
  }, []);

  const loginAnonymous = async () => {
    setPatch({ loading: true, error: null });
    try {
      await bootstrapSession(await startAnonymousWebSession());
    } catch (error) {
      setPatch({ error: friendlyError(error), loading: false });
    }
  };

  const loginPassword = async () => {
    setPatch({ loading: true, error: null });
    try {
      await bootstrapSession(await signInWithPassword(email.trim(), password));
    } catch (error) {
      setPatch({ error: friendlyError(error), loading: false });
    }
  };

  const logout = () => {
    clearWebSession();
    setState(initialState());
    setPatch({ loading: false });
  };

  const toggleAsset = async (asset: GalleryMediaAsset) => {
    if (!state.session || !workspace) return;
    const nextIds = nextSelectionAssetIds(state.selection, asset);
    const response = state.selection
      ? await updateSelection(state.session.accessToken, state.selection.id, { assetIds: nextIds })
      : await createSelection(state.session.accessToken, {
          workspaceId: workspace.id,
          name: "Seleccion web",
          assetIds: nextIds
        });
    setPatch({ selection: response.selection, message: `${nextIds.length} fotos en la seleccion.` });
  };

  const handleFiles = async (files: FileList | File[]) => {
    if (!state.session || !workspace) return;
    setUploading(true);
    setPatch({ error: null, message: null });
    try {
      const validFiles = [...files].filter((file) => ["image/jpeg", "image/png", "image/webp"].includes(file.type)).slice(0, 30);
      for (const file of validFiles) {
        const [sha256, dimensions] = await Promise.all([sha256OfFile(file), getImageDimensions(file)]);
        await uploadMediaAsset(state.session.accessToken, {
          workspaceId: workspace.id,
          business: activeBusiness,
          file,
          sha256,
          ...(dimensions.width > 0 ? { width: dimensions.width, height: dimensions.height } : {})
        });
      }
      setPatch({ message: `${validFiles.length} foto(s) enviadas a la galeria.` });
      await refreshGallery();
    } catch (error) {
      setPatch({ error: friendlyError(error) });
    } finally {
      setUploading(false);
    }
  };

  const saveAsset = async (asset: GalleryMediaAsset, body: { displayName?: string; categoryId?: string | null; tags?: string[] }) => {
    if (!state.session) return;
    const next = await updateMediaAsset(state.session.accessToken, asset.id, body);
    setPatch({
      assets: state.assets.map((item) => (item.id === next.id ? next : item)),
      activeAsset: next,
      message: "Foto guardada."
    });
  };

  const createCategory = async () => {
    if (!state.session || !workspace || !newCategoryName.trim()) return;
    const category = await createMediaCategory(state.session.accessToken, {
      workspaceId: workspace.id,
      name: newCategoryName.trim()
    });
    setNewCategoryName("");
    setPatch({ categories: [...state.categories, category], message: "Categoria creada." });
  };

  const importMenu = async () => {
    if (!state.session || !workspace || !menuText.trim()) return;
    setImportingMenu(true);
    setPatch({ error: null, message: null });
    try {
      await ingestMenuText(state.session.accessToken, {
        workspaceId: workspace.id,
        ...(activeBusiness ? { businessId: activeBusiness.id } : {}),
        text: menuText.trim()
      });
      setMenuText("");
      setPatch({ message: "Menu enviado para extraccion. Actualiza en unos momentos para ver categorias nuevas." });
    } catch (error) {
      setPatch({ error: friendlyError(error) });
    } finally {
      setImportingMenu(false);
    }
  };

  const convertSelection = async () => {
    if (!state.session || !state.selection || selectedIds.length === 0) return;
    await consumeSelection(state.session.accessToken, state.selection.id, activeBusiness?.id);
    setPatch({ message: "Seleccion convertida en lote.", selection: null });
    await refreshGallery();
  };

  if (state.loading) {
    return <main className="screen center"><div className="loader" /><p>Abriendo Maniaco...</p></main>;
  }

  if (!state.session || !state.bootstrap?.authenticated) {
    return (
      <main className="screen auth-screen">
        <section className="auth-panel">
          <div>
            <p className="eyebrow">Maniaco Web</p>
            <h1>Galeria sincronizada</h1>
            <p className="muted">Administra fotos, categorias y selecciones desde escritorio.</p>
          </div>
          {state.error ? <p className="alert">{state.error}</p> : null}
          <div className="form-grid">
            <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="correo" autoComplete="email" />
            <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="contrasena" type="password" autoComplete="current-password" />
            <button onClick={loginPassword} disabled={!config.supabaseUrl || !config.supabaseAnonKey || !email || !password}>
              Iniciar con Supabase
            </button>
          </div>
          <button className="secondary" onClick={loginAnonymous}>Entrar en modo piloto</button>
          <p className="hint">PowerSync: {isPowerSyncConfigured() ? "configurado" : "pendiente de URL"}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Maniaco Web</p>
          <h1>{workspace?.name ?? "Workspace"}</h1>
        </div>
        <div className="topbar-actions">
          <span className="pill">{state.syncMode === "powersync" ? "PowerSync activo" : "API directa"}</span>
          <button className="secondary compact" onClick={() => void refreshGallery()}>Actualizar</button>
          <button className="ghost compact" onClick={logout}>Salir</button>
        </div>
      </header>

      {state.error ? <p className="alert">{state.error}</p> : null}
      {state.message ? <p className="success">{state.message}</p> : null}

      <section className="workspace-grid">
        <aside className="sidebar">
          <h2>Paginas</h2>
          {state.businesses.length === 0 ? <p className="muted">Conecta Facebook desde la app movil para poblar paginas.</p> : null}
          {state.businesses.map((business) => (
            <article className="business-row" key={business.id}>
              <strong>{business.name}</strong>
              <span>{business.timezone}</span>
            </article>
          ))}

          <h2>Categorias</h2>
          <button className={!state.filters.categoryId ? "chip active" : "chip"} onClick={() => setPatch({ filters: { ...state.filters, categoryId: null } })}>
            Todas
          </button>
          {state.categories.map((category) => (
            <button className={state.filters.categoryId === category.id ? "chip active" : "chip"} key={category.id} onClick={() => setPatch({ filters: { ...state.filters, categoryId: category.id } })}>
              {category.name}
            </button>
          ))}
          <div className="inline-form">
            <input value={newCategoryName} onChange={(event) => setNewCategoryName(event.target.value)} placeholder="Nueva categoria" />
            <button className="compact" onClick={createCategory}>Crear</button>
          </div>

          <h2>Menu</h2>
          <textarea
            value={menuText}
            onChange={(event) => setMenuText(event.target.value)}
            placeholder="Pega aqui tu menu para extraer productos y keywords"
            rows={5}
          />
          <button className="compact" disabled={!menuText.trim() || importingMenu} onClick={importMenu}>
            {importingMenu ? "Importando..." : "Importar menu"}
          </button>
          <div className="menu-list">
            {state.menuItems.slice(0, 8).map((item) => (
              <span className="menu-row" key={item.id}>
                {item.name}
              </span>
            ))}
          </div>
        </aside>

        <section className="gallery-panel">
          <div className="toolbar">
            <input value={state.filters.search} onChange={(event) => setPatch({ filters: { ...state.filters, search: event.target.value } })} placeholder="Buscar por nombre, archivo o ruta" />
            <select value={state.filters.sort} onChange={(event) => setPatch({ filters: { ...state.filters, sort: event.target.value as GalleryFilters["sort"] } })}>
              <option value="recent">Recientes</option>
              <option value="most_used">Mas usadas</option>
              <option value="name">Nombre</option>
            </select>
            <label><input type="checkbox" checked={state.filters.unused} onChange={(event) => setPatch({ filters: { ...state.filters, unused: event.target.checked } })} /> No usadas</label>
            <label><input type="checkbox" checked={state.filters.archived} onChange={(event) => setPatch({ filters: { ...state.filters, archived: event.target.checked } })} /> Archivadas</label>
          </div>

          <label className="dropzone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
            event.preventDefault();
            void handleFiles(event.dataTransfer.files);
          }}>
            <input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => event.target.files && void handleFiles(event.target.files)} />
            <span>{uploading ? "Subiendo..." : "Arrastra fotos o toca para subir"}</span>
            <small>JPG, PNG, WebP · maximo 30 por tanda</small>
          </label>

          <div className="asset-grid">
            {filteredAssets.map((asset) => {
              const selected = selectedIds.includes(asset.id);
              return (
                <button className={selected ? "asset-card selected" : "asset-card"} key={asset.id} onClick={() => void toggleAsset(asset)} onDoubleClick={() => setPatch({ activeAsset: asset })}>
                  {asset.thumbnailUrl || asset.previewUrl ? <img src={asset.thumbnailUrl ?? asset.previewUrl ?? ""} alt={asset.displayName ?? asset.originalName ?? "Foto"} /> : <span className="placeholder">Sin vista</span>}
                  <span>{asset.displayName ?? asset.originalName ?? "Foto sin nombre"}</span>
                  <small>{categoryName(state.categories, asset.categoryId)} · {asset.status}</small>
                </button>
              );
            })}
          </div>
        </section>

        <aside className="selection-panel">
          <h2>Seleccion activa</h2>
          <strong>{selectedIds.length} foto(s)</strong>
          <p className="muted">Esta seleccion es compartida con el movil cuando usas el mismo usuario.</p>
          <button disabled={selectedIds.length === 0} onClick={convertSelection}>Convertir en lote</button>

          {state.activeAsset ? (
            <AssetDetail
              asset={state.activeAsset}
              categories={state.categories}
              onClose={() => setPatch({ activeAsset: null })}
              onSave={(body) => void saveAsset(state.activeAsset!, body)}
              onArchive={async () => {
                if (!state.session || !state.activeAsset) return;
                const archived = !state.activeAsset.archivedAt;
                const next = await archiveMediaAsset(state.session.accessToken, state.activeAsset.id, archived);
                setPatch({
                  assets: state.assets.map((item) => (item.id === next.id ? next : item)),
                  activeAsset: next,
                  message: archived ? "Foto archivada." : "Foto restaurada."
                });
              }}
            />
          ) : (
            <p className="muted">Doble clic en una foto para editar metadata.</p>
          )}
        </aside>
      </section>
    </main>
  );
};

const AssetDetail = (props: {
  asset: GalleryMediaAsset;
  categories: MediaCategory[];
  onClose: () => void;
  onSave: (body: { displayName?: string; categoryId?: string | null; tags?: string[] }) => void;
  onArchive: () => void;
}) => {
  const [displayName, setDisplayName] = useState(props.asset.displayName ?? props.asset.originalName ?? "");
  const [categoryId, setCategoryId] = useState(props.asset.categoryId ?? "");
  const [tags, setTags] = useState("");

  useEffect(() => {
    setDisplayName(props.asset.displayName ?? props.asset.originalName ?? "");
    setCategoryId(props.asset.categoryId ?? "");
    setTags("");
  }, [props.asset.id]);

  return (
    <section className="detail-panel">
      <div className="detail-head">
        <h2>Detalle</h2>
        <button className="ghost compact" onClick={props.onClose}>Cerrar</button>
      </div>
      {props.asset.previewUrl || props.asset.thumbnailUrl ? <img className="detail-image" src={props.asset.previewUrl ?? props.asset.thumbnailUrl ?? ""} alt="" /> : null}
      <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
      <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
        <option value="">Sin categoria</option>
        {props.categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}
      </select>
      <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="tags separados por coma" />
      <button onClick={() => props.onSave({
        displayName: displayName.trim(),
        categoryId: categoryId || null,
        tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean)
      })}>Guardar</button>
      <button className="secondary" onClick={props.onArchive}>{props.asset.archivedAt ? "Restaurar" : "Archivar"}</button>
    </section>
  );
};
