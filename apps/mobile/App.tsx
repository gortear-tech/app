import { QueryClient, QueryClientProvider, useMutation, useQuery } from "@tanstack/react-query";
import type { MetaPage } from "@fbmaniaco/shared";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { StatusBar } from "expo-status-bar";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useMemo, useState, type ComponentProps } from "react";
import {
  ActivityIndicator,
  AppState,
  Image,
  ImageBackground,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import {
  approveVariant,
  cancelScheduledPost,
  collectMetrics,
  confirmBatchCost,
  confirmCalendar,
  connectMeta,
  createBatch,
  clearStoredSession,
  ensureSessionForMeta,
  estimateBatchCost,
  generateBatchVariants,
  generateWeeklyReport,
  getActiveBatch,
  getBatchDetail,
  getBillingStatus,
  getBootstrapStatus,
  getBusinessDetail,
  getPerformance,
  getStoredSessionToken,
  getWeeklyReport,
  listMetaPages,
  listScheduledPosts,
  publishScheduledPost,
  rejectVariant,
  runCaptionEval,
  selectMetaPage,
  updateBusinessAutonomy,
  updateVariantCaption,
  uploadPhoto
} from "./src/api/client";
import { getMobileConfig } from "./src/config";

const queryClient = new QueryClient();
WebBrowser.maybeCompleteAuthSession();
type TabKey = "today" | "create" | "calendar" | "business";
type IconName = ComponentProps<typeof Ionicons>["name"];

function BootScreen() {
  const config = getMobileConfig();
  const [tab, setTab] = useState<TabKey>("today");
  const [captionDrafts, setCaptionDrafts] = useState<Record<string, string>>({});
  const [metaReturnMessage, setMetaReturnMessage] = useState<string | null>(null);

  const tokenQuery = useQuery({ queryKey: ["session-token"], queryFn: getStoredSessionToken });

  const handleMetaReturn = useCallback((url: string | null) => {
    if (!url?.startsWith("fbmaniaco://meta-connected")) return;
    const succeeded = url.includes("status=success");
    setMetaReturnMessage(
      succeeded
        ? "Facebook conectado. Actualizando tus paginas..."
        : "Facebook no completo la autorizacion. Intenta conectar otra vez."
    );
    void queryClient.invalidateQueries({ queryKey: ["session-token"] });
    void queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
    void queryClient.invalidateQueries({ queryKey: ["pages"] });
  }, []);
  const token = tokenQuery.data ?? "";
  const bootstrap = useQuery({
    queryKey: ["bootstrap"],
    queryFn: async () => {
      if (!token) return { authenticated: false as const, nextStep: "sign_in" as const };
      return getBootstrapStatus(token);
    },
    enabled: tokenQuery.isSuccess,
    retry: 1
  });

  const selectedBusinessId = bootstrap.data?.authenticated ? bootstrap.data.selectedBusinessId : null;
  const selectedPageId = bootstrap.data?.authenticated ? bootstrap.data.selectedPageId : null;
  const activeBatch = useQuery({
    queryKey: ["active-batch", selectedBusinessId],
    queryFn: async () => getActiveBatch(token, selectedBusinessId ?? ""),
    enabled: Boolean(token && bootstrap.data?.nextStep === "home" && selectedBusinessId)
  });
  const batchDetail = useQuery({
    queryKey: ["batch-detail", selectedBusinessId, activeBatch.data?.id],
    queryFn: async () => getBatchDetail(token, selectedBusinessId ?? "", activeBatch.data?.id ?? ""),
    enabled: Boolean(token && selectedBusinessId && activeBatch.data?.id)
  });
  const scheduledPosts = useQuery({
    queryKey: ["scheduled-posts", selectedBusinessId],
    queryFn: async () => listScheduledPosts(token, selectedBusinessId ?? ""),
    enabled: Boolean(token && selectedBusinessId && bootstrap.data?.nextStep === "home")
  });
  const performance = useQuery({
    queryKey: ["performance", selectedBusinessId],
    queryFn: async () => getPerformance(token, selectedBusinessId ?? ""),
    enabled: Boolean(token && selectedBusinessId && bootstrap.data?.nextStep === "home")
  });
  const weeklyReport = useQuery({
    queryKey: ["weekly-report", selectedBusinessId],
    queryFn: async () => getWeeklyReport(token, selectedBusinessId ?? ""),
    enabled: Boolean(token && selectedBusinessId && bootstrap.data?.nextStep === "home")
  });
  const businessDetail = useQuery({
    queryKey: ["business-detail", selectedBusinessId],
    queryFn: async () => getBusinessDetail(token, selectedBusinessId ?? ""),
    enabled: Boolean(token && selectedBusinessId && bootstrap.data?.nextStep === "home")
  });
  const billing = useQuery({
    queryKey: ["billing-status"],
    queryFn: async () => getBillingStatus(token),
    enabled: Boolean(token && bootstrap.data?.nextStep === "home")
  });
  const pages = useQuery({
    queryKey: ["pages"],
    queryFn: async () => listMetaPages(token),
    enabled: Boolean(
      token &&
        bootstrap.data?.authenticated &&
        (bootstrap.data.nextStep === "select_page" || bootstrap.data.nextStep === "home")
    )
  });
  const selectedPage = useMemo(
    () => (pages.data ?? []).find((page) => page.id === selectedPageId || page.isSelected) ?? null,
    [pages.data, selectedPageId]
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      void queryClient.invalidateQueries({ queryKey: ["session-token"] });
      void queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
      void queryClient.invalidateQueries({ queryKey: ["pages"] });
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    void Linking.getInitialURL().then(handleMetaReturn);
    const subscription = Linking.addEventListener("url", (event) => handleMetaReturn(event.url));
    return () => subscription.remove();
  }, [handleMetaReturn]);

  const invalidateWork = async () => {
    await queryClient.invalidateQueries({ queryKey: ["active-batch"] });
    await queryClient.invalidateQueries({ queryKey: ["batch-detail"] });
    await queryClient.invalidateQueries({ queryKey: ["scheduled-posts"] });
    await queryClient.invalidateQueries({ queryKey: ["performance"] });
    await queryClient.invalidateQueries({ queryKey: ["weekly-report"] });
    await queryClient.invalidateQueries({ queryKey: ["business-detail"] });
    await queryClient.invalidateQueries({ queryKey: ["billing-status"] });
  };

  const connect = useMutation({
    mutationFn: async () => {
      const sessionToken = await ensureSessionForMeta();
      queryClient.setQueryData(["session-token"], sessionToken);
      return connectMeta(sessionToken);
    },
    onSuccess: async (result) => {
      if (result.authorizationUrl) {
        try {
          const authResult = await WebBrowser.openAuthSessionAsync(result.authorizationUrl, "fbmaniaco://meta-connected");
          if (authResult.type === "success") {
            handleMetaReturn(authResult.url);
          } else if (authResult.type === "cancel" || authResult.type === "dismiss") {
            setMetaReturnMessage("Facebook se cerro antes de terminar la autorizacion.");
          }
        } catch {
          await Linking.openURL(result.authorizationUrl);
        }
      }
      await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
      await queryClient.invalidateQueries({ queryKey: ["pages"] });
    }
  });
  const signOut = useMutation({
    mutationFn: clearStoredSession,
    onSuccess: async () => {
      queryClient.clear();
      await queryClient.invalidateQueries({ queryKey: ["session-token"] });
    }
  });
  const selectPage = useMutation({
    mutationFn: async (pageId: string) => selectMetaPage(token, pageId),
    onSuccess: async (result) => {
      queryClient.setQueryData(["bootstrap"], result.bootstrap);
      setTab("create");
      await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
      await queryClient.invalidateQueries({ queryKey: ["pages"] });
      await invalidateWork();
    }
  });
  const startBatch = useMutation({ mutationFn: async () => createBatch(token, selectedBusinessId ?? ""), onSuccess: invalidateWork });
  const uploadSelectedPhoto = useMutation({
    mutationFn: async () => {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) throw new Error("Necesitamos permiso para elegir fotos.");
      const selection = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.95,
        allowsMultipleSelection: false
      });
      if (selection.canceled || !selection.assets[0]) throw new Error("No se eligio ninguna foto.");
      const asset = selection.assets[0];
      const upload = {
        uri: asset.uri,
        name: asset.fileName ?? `foto-${Date.now()}.jpg`,
        contentType: asset.mimeType ?? "image/jpeg",
        width: asset.width,
        height: asset.height
      };
      return uploadPhoto(token, selectedBusinessId ?? "", activeBatch.data?.id ?? "", {
        ...upload,
        ...(asset.fileSize === undefined ? {} : { fileSize: asset.fileSize })
      });
    },
    onSuccess: invalidateWork
  });
  const generateVariants = useMutation({
    mutationFn: async () => {
      const businessId = selectedBusinessId ?? "";
      const batchId = activeBatch.data?.id ?? "";
      const estimate = await estimateBatchCost(token, businessId, batchId, 1);
      if (!estimate.canConfirm) throw new Error("Este lote supera el limite disponible.");
      await confirmBatchCost(token, businessId, batchId, 1, estimate.priceVersion);
      return generateBatchVariants(token, businessId, batchId, 1);
    },
    onSuccess: invalidateWork
  });
  const saveCaption = useMutation({
    mutationFn: async (variantId: string) =>
      updateVariantCaption(token, selectedBusinessId ?? "", activeBatch.data?.id ?? "", variantId, captionDrafts[variantId] ?? ""),
    onSuccess: invalidateWork
  });
  const approve = useMutation({
    mutationFn: async (variantId: string) => approveVariant(token, selectedBusinessId ?? "", activeBatch.data?.id ?? "", variantId),
    onSuccess: invalidateWork
  });
  const reject = useMutation({
    mutationFn: async (variantId: string) => rejectVariant(token, selectedBusinessId ?? "", activeBatch.data?.id ?? "", variantId),
    onSuccess: invalidateWork
  });
  const schedule = useMutation({
    mutationFn: async () => confirmCalendar(token, selectedBusinessId ?? "", activeBatch.data?.id ?? "", 7),
    onSuccess: async () => {
      setTab("calendar");
      await invalidateWork();
    }
  });
  const publishNow = useMutation({
    mutationFn: async (post: { id: string; batchId: string }) => publishScheduledPost(token, selectedBusinessId ?? "", post.batchId, post.id),
    onSuccess: invalidateWork
  });
  const cancelPost = useMutation({
    mutationFn: async (post: { id: string; batchId: string }) => cancelScheduledPost(token, selectedBusinessId ?? "", post.batchId, post.id),
    onSuccess: invalidateWork
  });
  const collect = useMutation({ mutationFn: async () => collectMetrics(token, selectedBusinessId ?? ""), onSuccess: invalidateWork });
  const reportGenerate = useMutation({
    mutationFn: async () => generateWeeklyReport(token, selectedBusinessId ?? ""),
    onSuccess: invalidateWork
  });
  const resetAutonomy = useMutation({
    mutationFn: async () => {
      const settings = businessDetail.data?.business.autonomySettings as
        | { actions?: Record<string, Record<string, unknown>> }
        | undefined;
      const timestamp = new Date().toISOString();
      return updateBusinessAutonomy(token, selectedBusinessId ?? "", {
        schemaVersion: "business_autonomy.v1",
        actions: Object.fromEntries(
          Object.entries(settings?.actions ?? {}).map(([action, value]) => [
            action,
            {
              ...value,
              mode: action === "FACEBOOK_PUBLISH" ? "human_approval" : "suggest_only",
              paused: action === "FACEBOOK_PUBLISH",
              explicitOptIn: false,
              score: 0,
              approvals: 0,
              consecutiveApprovals: 0,
              consecutiveRejections: 0,
              pauseReasons: action === "FACEBOOK_PUBLISH" ? ["explicit_opt_in_required"] : [],
              updatedAt: timestamp
            }
          ])
        ),
        updatedAt: timestamp
      });
    },
    onSuccess: invalidateWork
  });
  const captionEval = useMutation({ mutationFn: async () => runCaptionEval(token, selectedBusinessId ?? ""), onSuccess: invalidateWork });

  const openPage = (page: MetaPage) => {
    if (page.id === selectedPage?.id || page.isSelected) {
      setTab("create");
      return;
    }
    selectPage.mutate(page.id);
  };

  const stateText = useMemo(() => {
    if (bootstrap.isLoading) return "Revisando conexion inicial...";
    if (bootstrap.isError) return "No pudimos conectar con FBmaniaco.";
    if (!bootstrap.data?.authenticated) return "Conecta Facebook para empezar.";
    if (bootstrap.data.nextStep === "connect_meta" || bootstrap.data.nextStep === "recover_meta") return "Sesion segura lista.";
    if (bootstrap.data.nextStep === "select_page") return "Facebook conectado: elige pagina.";
    return `Pagina activa: ${selectedPage?.pageName ?? businessDetail.data?.business.name ?? "FBmaniaco"}`;
  }, [bootstrap.data, bootstrap.isError, bootstrap.isLoading, businessDetail.data?.business.name, selectedPage?.pageName]);

  const refreshAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["session-token"] }),
      queryClient.invalidateQueries({ queryKey: ["bootstrap"] }),
      queryClient.invalidateQueries({ queryKey: ["pages"] }),
      queryClient.invalidateQueries({ queryKey: ["active-batch"] }),
      queryClient.invalidateQueries({ queryKey: ["batch-detail"] }),
      queryClient.invalidateQueries({ queryKey: ["scheduled-posts"] }),
      queryClient.invalidateQueries({ queryKey: ["performance"] }),
      queryClient.invalidateQueries({ queryKey: ["weekly-report"] }),
      queryClient.invalidateQueries({ queryKey: ["business-detail"] }),
      queryClient.invalidateQueries({ queryKey: ["billing-status"] })
    ]);
  };

  const visibleError =
    bootstrap.error ??
    signOut.error ??
    connect.error ??
    pages.error ??
    selectPage.error ??
    activeBatch.error ??
    batchDetail.error ??
    scheduledPosts.error ??
    performance.error ??
    weeklyReport.error ??
    businessDetail.error ??
    billing.error ??
    startBatch.error ??
    uploadSelectedPhoto.error ??
    generateVariants.error ??
    saveCaption.error ??
    approve.error ??
    reject.error ??
    schedule.error ??
    publishNow.error ??
    cancelPost.error ??
    collect.error ??
    reportGenerate.error ??
    resetAutonomy.error ??
    captionEval.error;

  const photos = batchDetail.data?.photos ?? [];
  const variants = batchDetail.data?.variants ?? [];
  const generated = variants.filter((variant) => variant.status === "generada");
  const approvedCount = variants.filter((variant) => variant.status === "aprobada" || variant.status === "programada").length;
  const posts = scheduledPosts.data ?? [];
  const failedPosts = posts.filter((post) => post.status === "fallida" || post.status === "estado_incierto");
  const activePosts = posts.filter((post) => post.status !== "cancelada");
  const weekCoverage = Math.min(100, Math.round((activePosts.length / 7) * 100));
  const latestBusinessSummary = (performance.data?.summaries ?? []).find((summary) => summary.scope === "business_week");
  const needsReconnect = bootstrap.data?.authenticated && bootstrap.data.facebookTokenStatus === "expirado";
  const refreshing =
    tokenQuery.isFetching ||
    bootstrap.isFetching ||
    pages.isFetching ||
    activeBatch.isFetching ||
    batchDetail.isFetching ||
    scheduledPosts.isFetching ||
    performance.isFetching ||
    weeklyReport.isFetching ||
    businessDetail.isFetching ||
    billing.isFetching;
  const nextAction = !activeBatch.data
    ? "Crear lote"
    : photos.some((photo) => photo.status === "validada") && variants.length === 0
      ? "Generar variantes"
      : generated.length > 0
        ? "Aprobar variantes"
        : approvedCount > 0
          ? "Confirmar calendario"
          : "Revisar progreso";

  const renderOnboarding = () => {
    if (!bootstrap.data?.authenticated) {
      return (
        <Screen>
          <Hero
            title="Conecta Facebook"
            eyebrow="Inicio"
            body="Abriremos Meta para autorizar tus paginas. FBmaniaco mantiene una sesion segura en este telefono para volver directo despues."
          />
          <Button
            label={connect.isPending ? "Abriendo Facebook..." : "Continuar con Facebook"}
            icon="logo-facebook"
            disabled={connect.isPending || tokenQuery.isFetching}
            onPress={() => connect.mutate()}
          />
          {metaReturnMessage ? <Text style={styles.muted}>{metaReturnMessage}</Text> : null}
        </Screen>
      );
    }

    if (bootstrap.data?.nextStep === "connect_meta" || bootstrap.data?.nextStep === "recover_meta") {
      return (
        <Screen>
          <Hero
            title={bootstrap.data.nextStep === "recover_meta" ? "Reconecta Facebook" : "Conecta Facebook"}
            eyebrow="Permisos"
            body="FBmaniaco usa Meta para leer paginas y publicar solo cuando tu lo confirmas."
          />
          <Button label={connect.isPending ? "Conectando..." : "Conectar con Facebook"} icon="logo-facebook" disabled={connect.isPending} onPress={() => connect.mutate()} />
          {metaReturnMessage ? <Text style={styles.muted}>{metaReturnMessage}</Text> : null}
        </Screen>
      );
    }

    if (bootstrap.data?.nextStep === "select_page") {
      return (
        <Screen>
          {pages.isLoading ? <ActivityIndicator color={palette.cyan} /> : null}
          {!pages.isLoading && (pages.data ?? []).length === 0 ? (
            <EmptyState title="No encontramos paginas" body="Revisa permisos de Facebook y vuelve a conectar." />
          ) : null}
          {(pages.data ?? []).map((page) => (
            <PageCard
              key={page.id}
              page={page}
              disabled={selectPage.isPending}
              onPress={() => openPage(page)}
            />
          ))}
        </Screen>
      );
    }

    return null;
  };

  const renderToday = () => (
    <Screen>
      {needsReconnect ? <Alert message="Facebook necesita reconexion para publicar." tone="critical" /> : null}
      {failedPosts.length > 0 ? <Alert message="Hay publicaciones que necesitan revision." tone="warning" /> : null}
      <Hero title={nextAction} eyebrow="Siguiente accion" body={`Semana cubierta: ${weekCoverage}%`} />
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${weekCoverage}%` }]} />
      </View>
      <MetricGrid
        items={[
          { label: "Fotos", value: String(activeBatch.data?.photosCount ?? 0) },
          { label: "Variantes", value: String(activeBatch.data?.variantsCount ?? 0) },
          { label: "Posts", value: String(posts.length) }
        ]}
      />
      <Panel title={activeBatch.data ? `Lote ${activeBatch.data.status}` : "Sin lote activo"}>
        <Text style={styles.muted}>
          {activeBatch.data
            ? `Ultima actividad: ${new Date(activeBatch.data.lastActivityAt).toLocaleString()}`
            : "Crea un lote para preparar publicaciones desde el celular."}
        </Text>
        <Button
          label={activeBatch.data ? "Ir a crear" : "Crear lote"}
          icon={activeBatch.data ? "arrow-forward" : "add-circle-outline"}
          variant={activeBatch.data ? "secondary" : "primary"}
          onPress={() => {
            setTab("create");
            if (!activeBatch.data) startBatch.mutate();
          }}
          disabled={startBatch.isPending || !selectedBusinessId}
        />
      </Panel>
      <Panel title="Aprendizaje">
        <Text style={styles.muted}>Confianza: {latestBusinessSummary?.confidence ?? "exploratoria"}</Text>
        <Text style={styles.muted}>Muestra: {latestBusinessSummary?.sampleSize ?? 0} publicaciones.</Text>
        <Text style={styles.muted}>No se declaran ganadores con muestra pequena.</Text>
      </Panel>
    </Screen>
  );

  const renderCreate = () => (
    <Screen>
      <Panel title="Crear publicacion" eyebrow={selectedPage?.pageName ?? "Pagina"}>
        <Text style={styles.muted}>
          {activeBatch.data ? "Sube fotos reales y prepara captions para esta pagina." : "Empieza un lote para trabajar tus publicaciones de la semana."}
        </Text>
        {activeBatch.data ? (
          <ActionPair
            primaryLabel={uploadSelectedPhoto.isPending ? "Subiendo..." : "Subir foto"}
            primaryDisabled={uploadSelectedPhoto.isPending}
            onPrimary={() => uploadSelectedPhoto.mutate()}
            primaryIcon="images-outline"
            secondaryLabel={startBatch.isPending ? "Creando..." : "Nuevo lote"}
            secondaryDisabled={startBatch.isPending || !selectedBusinessId}
            onSecondary={() => startBatch.mutate()}
            secondaryIcon="add-circle-outline"
          />
        ) : (
          <Button
            label={startBatch.isPending ? "Creando..." : "Crear lote"}
            icon="add-circle-outline"
            disabled={startBatch.isPending || !selectedBusinessId}
            onPress={() => startBatch.mutate()}
          />
        )}
      </Panel>
      <Panel title="Fotos">
        {photos.length === 0 ? <EmptyState title="Aun no hay fotos" body="Sube una foto real para preparar la publicacion." /> : null}
        {photos.map((photo) => (
          <View key={photo.id} style={styles.mediaRow}>
            <Image source={{ uri: photo.thumbnailUrl ?? undefined }} style={styles.thumbnail} />
            <View style={styles.flex}>
              <Text style={styles.rowTitle}>{photo.fileName ?? "Foto"}</Text>
              <Text style={styles.muted}>{photo.status === "validada" ? "Analisis listo" : "En proceso por worker"}</Text>
            </View>
            <Pill label={photo.status} tone={photo.status === "validada" ? "good" : "neutral"} />
          </View>
        ))}
      </Panel>
      {photos.some((photo) => photo.status === "validada") && variants.length === 0 ? (
        <Button label={generateVariants.isPending ? "Preparando..." : "Preparar publicacion"} icon="sparkles-outline" disabled={generateVariants.isPending} onPress={() => generateVariants.mutate()} />
      ) : null}
      {generated.map((variant, index) => (
        <Panel key={variant.id} title={variant.assignedStyle?.styleName ?? "Variante"} eyebrow={`${index + 1} de ${generated.length}`}>
          <Image source={{ uri: variant.imageUrl ?? undefined }} style={styles.variantImage} resizeMode="contain" />
          <TextInput
            multiline
            style={styles.captionInput}
            value={captionDrafts[variant.id] ?? variant.caption ?? ""}
            onChangeText={(value) => setCaptionDrafts((current) => ({ ...current, [variant.id]: value }))}
          />
          <ActionPair
            primaryLabel="Aprobar"
            primaryDisabled={approve.isPending}
            onPrimary={() => approve.mutate(variant.id)}
            primaryIcon="checkmark-circle-outline"
            secondaryLabel="Guardar caption"
            secondaryDisabled={saveCaption.isPending}
            onSecondary={() => saveCaption.mutate(variant.id)}
            secondaryIcon="save-outline"
          />
          <Button label="Rechazar variante" icon="close-circle-outline" variant="danger" disabled={reject.isPending} onPress={() => reject.mutate(variant.id)} />
        </Panel>
      ))}
      {approvedCount > 0 ? (
        <Button label={schedule.isPending ? "Programando..." : "Confirmar calendario de 7 dias"} icon="calendar-outline" disabled={schedule.isPending} onPress={() => schedule.mutate()} />
      ) : null}
    </Screen>
  );

  const renderCalendar = () => (
    <Screen>
      <Hero title={`${posts.length} publicaciones`} eyebrow="Calendario" body={`Cobertura semanal: ${weekCoverage}%`} />
      {posts.length === 0 ? <EmptyState title="No hay calendario" body="Aprueba variantes y confirma calendario para ver publicaciones aqui." /> : null}
      {posts.map((post) => (
        <View key={post.id} style={styles.calendarCard}>
          <View style={styles.timelineDot} />
          <View style={styles.flex}>
            <Text style={styles.rowTitle}>{new Date(post.scheduledFor).toLocaleString()}</Text>
            <Text style={styles.muted}>{post.status} / {post.remoteStatus}</Text>
            <Text style={styles.captionPreview}>{post.caption ?? "Sin caption"}</Text>
          </View>
          {post.status === "programada" ? (
            <View style={styles.compactActions}>
              <MiniButton label="Publicar" onPress={() => publishNow.mutate({ id: post.id, batchId: post.batchId })} disabled={publishNow.isPending} />
              <MiniButton label="Cancelar" tone="danger" onPress={() => cancelPost.mutate({ id: post.id, batchId: post.batchId })} disabled={cancelPost.isPending} />
            </View>
          ) : null}
        </View>
      ))}
    </Screen>
  );

  const renderBusiness = () => {
    const report = weeklyReport.data?.report ?? null;
    return (
      <Screen>
        <Panel title="Negocio">
          <Text style={styles.muted}>Workspace: {bootstrap.data?.authenticated ? bootstrap.data.workspace?.name : "Sin sesion"}</Text>
          <Text style={styles.muted}>Plan: {billing.data?.workspace.plan ?? "piloto"} / {billing.data?.workspace.billingStatus ?? "trial"}</Text>
          <View style={styles.policyRow}>
            <Ionicons name="shield-checkmark-outline" size={18} color={palette.good} />
            <View style={styles.flex}>
              <Text style={styles.rowTitle}>Publicacion con confirmacion</Text>
              <Text style={styles.muted}>Nada se envia a Facebook sin que lo apruebes.</Text>
            </View>
          </View>
          <Button label={signOut.isPending ? "Saliendo..." : "Cerrar sesion"} icon="log-out-outline" variant="secondary" disabled={signOut.isPending} onPress={() => signOut.mutate()} />
        </Panel>
        <Panel title="Paginas de Facebook">
          {(pages.data ?? []).length === 0 ? (
            <Text style={styles.muted}>Conecta Facebook para ver tus paginas.</Text>
          ) : null}
          {(pages.data ?? []).map((page) => (
            <PageCard
              key={page.id}
              page={page}
              selected={page.isSelected}
              disabled={selectPage.isPending}
              onPress={() => openPage(page)}
            />
          ))}
          <Button label={connect.isPending ? "Conectando..." : "Reconectar Facebook"} icon="logo-facebook" variant="secondary" disabled={connect.isPending} onPress={() => connect.mutate()} />
        </Panel>
        <Panel title="Reporte semanal">
          {report ? (
            <>
              <Text style={styles.muted}>{report.sections.worked[0]}</Text>
              <Text style={styles.muted}>{report.sections.didNotWork[0]}</Text>
              <Text style={styles.muted}>{report.sections.nextActions[0]}</Text>
            </>
          ) : (
            <Text style={styles.muted}>{weeklyReport.data?.emptyReason ?? "Genera un reporte cuando haya actividad."}</Text>
          )}
          <ActionPair
            primaryLabel={reportGenerate.isPending ? "Generando..." : "Reporte"}
            primaryDisabled={reportGenerate.isPending || !selectedBusinessId}
            onPrimary={() => reportGenerate.mutate()}
            primaryIcon="document-text-outline"
            secondaryLabel={collect.isPending ? "Recolectando..." : "Metricas"}
            secondaryDisabled={collect.isPending || !selectedBusinessId}
            onSecondary={() => collect.mutate()}
            secondaryIcon="analytics-outline"
          />
        </Panel>
        <Panel title="Autonomia">
          <Text style={styles.muted}>FACEBOOK_PUBLISH requiere opt-in explicito, token sano y presupuesto disponible.</Text>
          <Button label={resetAutonomy.isPending ? "Reseteando..." : "Resetear autonomia"} icon="shield-checkmark-outline" variant="secondary" disabled={resetAutonomy.isPending} onPress={() => resetAutonomy.mutate()} />
        </Panel>
        <Panel title="Evaluaciones IA">
          <Text style={styles.muted}>Las evaluaciones de captions corren como job y no bloquean aprobaciones en vivo.</Text>
          <Button label={captionEval.isPending ? "Encolando..." : "Ejecutar eval de captions"} icon="flask-outline" disabled={captionEval.isPending} onPress={() => captionEval.mutate()} />
        </Panel>
      </Screen>
    );
  };

  const renderCurrent = () => {
    if (bootstrap.data?.nextStep !== "home") return renderOnboarding();
    return (
      <>
        {tab === "today" ? renderToday() : null}
        {tab === "create" ? renderCreate() : null}
        {tab === "calendar" ? renderCalendar() : null}
        {tab === "business" ? renderBusiness() : null}
      </>
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <View style={styles.shell}>
        <ScrollView
          contentContainerStyle={styles.container}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refreshAll}
              tintColor={palette.facebook}
              colors={[palette.facebook]}
              progressBackgroundColor={palette.surface}
            />
          }
        >
          <TopBar busy={refreshing} onRefresh={refreshAll} />
          <ActivePageBanner
            page={selectedPage}
            stateText={stateText}
            helperText={config.appEnv === "development" ? `API: ${config.apiUrl}` : "Lista para trabajar con tus paginas."}
            loading={bootstrap.isLoading}
            onChangePage={() => setTab("business")}
          />
          {visibleError ? <Alert message={visibleError instanceof Error ? visibleError.message : "No pudimos continuar."} tone="critical" /> : null}
          {renderCurrent()}
        </ScrollView>
        {bootstrap.data?.nextStep === "home" ? <BottomTabs active={tab} onChange={setTab} failedPosts={failedPosts.length} /> : null}
      </View>
    </SafeAreaView>
  );
}

function Screen({ children }: { children: React.ReactNode }) {
  return <View style={styles.screen}>{children}</View>;
}

function TopBar({ busy, onRefresh }: { busy: boolean; onRefresh: () => void }) {
  return (
    <View style={styles.topBar}>
      <View style={styles.flex}>
        <Text style={styles.productKicker}>FBmaniaco</Text>
        <Text style={styles.productTitle}>Control de publicaciones</Text>
      </View>
      <IconButton icon={busy ? "sync" : "refresh"} label="Actualizar" disabled={busy} onPress={onRefresh} />
    </View>
  );
}

function ActivePageBanner({
  page,
  stateText,
  helperText,
  loading,
  onChangePage
}: {
  page: MetaPage | null;
  stateText: string;
  helperText: string;
  loading: boolean;
  onChangePage: () => void;
}) {
  if (!page) {
    return (
      <View style={styles.statusCard}>
        {loading ? <ActivityIndicator color={palette.facebook} /> : <Ionicons name="radio-button-on" size={18} color={palette.facebook} />}
        <View style={styles.flex}>
          <Text style={styles.statusText}>{stateText}</Text>
          <Text style={styles.muted} numberOfLines={2}>{helperText}</Text>
        </View>
      </View>
    );
  }

  const body = (
    <View style={styles.activePageOverlay}>
      <View style={styles.activePageRow}>
        {page.profilePhotoUrl ? (
          <Image source={{ uri: page.profilePhotoUrl }} style={styles.activeAvatar} />
        ) : (
          <View style={styles.activeAvatarFallback}>
            <Text style={styles.pageAvatarText}>{page.pageName.slice(0, 1).toUpperCase()}</Text>
          </View>
        )}
        <View style={styles.flex}>
          <Text style={styles.activeKicker}>Pagina activa</Text>
          <Text style={styles.activePageName} numberOfLines={2}>{page.pageName}</Text>
          <Text style={styles.activeMeta} numberOfLines={1}>{page.category ?? "Facebook Page"}</Text>
        </View>
        <View style={styles.changePagePill}>
          <Text style={styles.changePageText}>Cambiar</Text>
          <Ionicons name="chevron-forward" size={14} color={palette.ink} />
        </View>
      </View>
    </View>
  );

  return (
    <Pressable style={styles.activePageBanner} onPress={onChangePage} android_ripple={{ color: "rgba(255,255,255,0.08)" }}>
      {page.coverPhotoUrl ? (
        <ImageBackground source={{ uri: page.coverPhotoUrl }} style={styles.activeCover} imageStyle={styles.activeCoverImage}>
          {body}
        </ImageBackground>
      ) : (
        <View style={[styles.activeCover, styles.activeCoverFallback]}>{body}</View>
      )}
    </Pressable>
  );
}

function Hero({ title, eyebrow, body }: { title: string; eyebrow: string; body: string }) {
  return (
    <View style={styles.hero}>
      <Text style={styles.eyebrow}>{eyebrow}</Text>
      <Text style={styles.heroTitle}>{title}</Text>
      <Text style={styles.heroBody}>{body}</Text>
    </View>
  );
}

function IconButton({
  icon,
  label,
  onPress,
  disabled
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  disabled?: boolean | undefined;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      style={[styles.iconButton, disabled ? styles.disabled : null]}
      disabled={disabled}
      onPress={onPress}
      android_ripple={{ color: "rgba(255,255,255,0.10)", borderless: false }}
    >
      <Ionicons name={icon} size={21} color={palette.text} />
    </Pressable>
  );
}

function Panel({ title, eyebrow, children }: { title: string; eyebrow?: string; children: React.ReactNode }) {
  return (
    <View style={styles.panel}>
      {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
      <Text style={styles.panelTitle}>{title}</Text>
      {children}
    </View>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.rowTitle}>{title}</Text>
      <Text style={styles.muted}>{body}</Text>
    </View>
  );
}

function PageCard({
  page,
  onPress,
  disabled,
  selected
}: {
  page: MetaPage;
  onPress: () => void;
  disabled?: boolean | undefined;
  selected?: boolean | undefined;
}) {
  const isSelected = selected ?? page.isSelected;
  const statusLabel = page.canPublish ? "Lista para publicar" : page.isGranted ? "Sin permiso de publicar" : "Permisos incompletos";
  return (
    <Pressable
      style={[
        styles.pageCard,
        isSelected ? styles.pageCardSelected : null,
        !page.canPublish || disabled ? styles.disabled : null
      ]}
      disabled={!page.canPublish || disabled}
      onPress={onPress}
      android_ripple={{ color: "rgba(59,130,246,0.14)" }}
    >
      <View style={styles.pageCoverFrame}>
        {page.coverPhotoUrl ? (
          <Image source={{ uri: page.coverPhotoUrl }} style={styles.pageCover} />
        ) : (
          <View style={[styles.pageCover, styles.pageCoverPlaceholder]} />
        )}
        {isSelected ? (
          <View style={styles.selectedBadge}>
            <Ionicons name="checkmark-circle" size={14} color={palette.good} />
            <Text style={styles.selectedBadgeText}>Activa</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.pageCardBody}>
        {page.profilePhotoUrl ? (
          <Image source={{ uri: page.profilePhotoUrl }} style={styles.pageAvatar} />
        ) : (
          <View style={styles.pageAvatarPlaceholder}>
            <Text style={styles.pageAvatarText}>{page.pageName.slice(0, 1).toUpperCase()}</Text>
          </View>
        )}
        <View style={styles.flex}>
          <Text style={styles.pageName} numberOfLines={2}>{page.pageName}</Text>
          <Text style={styles.pageMeta} numberOfLines={1}>{page.category ?? "Facebook Page"}</Text>
          <View style={styles.pageBadges}>
            <Pill label={statusLabel} tone={page.canPublish ? "good" : "warn"} />
            <Pill label={page.pageAccessTokenStatus} tone={page.pageAccessTokenStatus === "valido" ? "good" : "warn"} />
          </View>
        </View>
        <Ionicons name="chevron-forward" size={20} color={palette.muted} />
      </View>
    </Pressable>
  );
}

function Alert({ message, tone }: { message: string; tone: "warning" | "critical" }) {
  return (
    <View style={[styles.alert, tone === "critical" ? styles.alertCritical : styles.alertWarning]}>
      <Text style={[styles.alertText, tone === "critical" ? styles.alertCriticalText : styles.alertWarningText]}>{message}</Text>
    </View>
  );
}

function Button({
  label,
  onPress,
  disabled,
  variant = "primary",
  icon
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean | undefined;
  variant?: "primary" | "secondary" | "danger";
  icon?: IconName | undefined;
}) {
  return (
    <Pressable
      style={[
        styles.button,
        variant === "secondary" ? styles.secondaryButton : null,
        variant === "danger" ? styles.dangerButton : null,
        disabled ? styles.disabled : null
      ]}
      disabled={disabled}
      onPress={onPress}
      android_ripple={{ color: variant === "primary" ? "rgba(255,255,255,0.22)" : "rgba(15,23,42,0.10)" }}
    >
      {icon ? (
        <Ionicons
          name={icon}
          size={18}
          color={variant === "primary" ? palette.ink : variant === "danger" ? palette.danger : palette.bg}
        />
      ) : null}
      <Text style={[styles.buttonText, variant === "secondary" ? styles.secondaryButtonText : null, variant === "danger" ? styles.dangerButtonText : null]}>
        {label}
      </Text>
    </Pressable>
  );
}

function ActionPair({
  primaryLabel,
  secondaryLabel,
  onPrimary,
  onSecondary,
  primaryDisabled,
  secondaryDisabled,
  primaryIcon,
  secondaryIcon
}: {
  primaryLabel: string;
  secondaryLabel: string;
  onPrimary: () => void;
  onSecondary: () => void;
  primaryDisabled?: boolean | undefined;
  secondaryDisabled?: boolean | undefined;
  primaryIcon?: IconName | undefined;
  secondaryIcon?: IconName | undefined;
}) {
  return (
    <View style={styles.actionPair}>
      <View style={styles.flex}>
        <Button label={secondaryLabel} icon={secondaryIcon} variant="secondary" disabled={secondaryDisabled} onPress={onSecondary} />
      </View>
      <View style={styles.flex}>
        <Button label={primaryLabel} icon={primaryIcon} disabled={primaryDisabled} onPress={onPrimary} />
      </View>
    </View>
  );
}

function MiniButton({ label, onPress, disabled, tone }: { label: string; onPress: () => void; disabled?: boolean | undefined; tone?: "danger" }) {
  return (
    <Pressable style={[styles.miniButton, tone === "danger" ? styles.miniDanger : null, disabled ? styles.disabled : null]} disabled={disabled} onPress={onPress}>
      <Text style={[styles.miniText, tone === "danger" ? styles.miniDangerText : null]}>{label}</Text>
    </Pressable>
  );
}

function MetricGrid({ items }: { items: Array<{ label: string; value: string }> }) {
  return (
    <View style={styles.metricGrid}>
      {items.map((item) => (
        <View key={item.label} style={styles.metricCell}>
          <Text style={styles.metricValue}>{item.value}</Text>
          <Text style={styles.metricLabel}>{item.label}</Text>
        </View>
      ))}
    </View>
  );
}

function Pill({ label, tone }: { label: string; tone: "good" | "warn" | "neutral" }) {
  return (
    <View style={[styles.pill, tone === "good" ? styles.pillGood : tone === "warn" ? styles.pillWarn : null]}>
      <Text style={[styles.pillText, tone === "good" ? styles.pillGoodText : tone === "warn" ? styles.pillWarnText : null]}>{label}</Text>
    </View>
  );
}

function BottomTabs({ active, onChange, failedPosts }: { active: TabKey; onChange: (tab: TabKey) => void; failedPosts: number }) {
  const tabs: Array<{ key: TabKey; label: string; icon: IconName; activeIcon: IconName }> = [
    { key: "today", label: "Hoy", icon: "home-outline", activeIcon: "home" },
    { key: "create", label: "Crear", icon: "add-circle-outline", activeIcon: "add-circle" },
    { key: "calendar", label: "Agenda", icon: "calendar-outline", activeIcon: "calendar" },
    { key: "business", label: "Paginas", icon: "albums-outline", activeIcon: "albums" }
  ];
  return (
    <View style={styles.tabs}>
      {tabs.map(({ key, label, icon, activeIcon }) => (
        <Pressable key={key} style={[styles.tab, active === key ? styles.activeTab : null]} onPress={() => onChange(key)}>
          <Ionicons name={active === key ? activeIcon : icon} size={19} color={active === key ? palette.ink : palette.muted} />
          <Text style={[styles.tabText, active === key ? styles.activeTabText : null]}>{label}</Text>
          {key === "calendar" && failedPosts > 0 ? <View style={styles.badge} /> : null}
        </Pressable>
      ))}
    </View>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BootScreen />
    </QueryClientProvider>
  );
}

const palette = {
  bg: "#11100f",
  surface: "#181716",
  panel: "#1d1b1a",
  panel2: "#24211f",
  border: "#34302d",
  text: "#f8fafc",
  muted: "#b8b1aa",
  facebook: "#3b82f6",
  cyan: "#3b82f6",
  white: "#f8fafc",
  ink: "#0b1220",
  good: "#34d399",
  danger: "#fecaca",
  warning: "#fde68a"
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  shell: { flex: 1 },
  container: { flexGrow: 1, gap: 14, padding: 16, paddingBottom: Platform.OS === "android" ? 136 : 116 },
  topBar: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingTop: 4
  },
  productKicker: { color: palette.facebook, fontSize: 12, fontWeight: "900", textTransform: "uppercase" },
  productTitle: { color: palette.text, fontSize: 27, fontWeight: "900", letterSpacing: 0 },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.panel
  },
  statusCard: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 8,
    padding: 12,
    backgroundColor: palette.panel
  },
  statusText: { color: palette.text, fontSize: 15, fontWeight: "800" },
  activePageBanner: {
    minHeight: 152,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 8,
    backgroundColor: palette.panel
  },
  activeCover: { minHeight: 152, justifyContent: "flex-end" },
  activeCoverImage: { opacity: 0.82 },
  activeCoverFallback: { backgroundColor: palette.panel2 },
  activePageOverlay: {
    minHeight: 152,
    justifyContent: "flex-end",
    padding: 14,
    backgroundColor: "rgba(10,10,10,0.38)"
  },
  activePageRow: { flexDirection: "row", alignItems: "flex-end", gap: 12 },
  activeAvatar: {
    width: 64,
    height: 64,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: palette.text,
    backgroundColor: palette.panel2
  },
  activeAvatarFallback: {
    width: 64,
    height: 64,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: palette.text,
    backgroundColor: palette.panel2
  },
  activeKicker: { color: "#dbeafe", fontSize: 11, fontWeight: "900", textTransform: "uppercase" },
  activePageName: { color: palette.text, fontSize: 24, fontWeight: "900", lineHeight: 28 },
  activeMeta: { color: "#e7e0d8", fontSize: 12, fontWeight: "700" },
  changePagePill: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 8,
    paddingHorizontal: 10,
    backgroundColor: palette.white
  },
  changePageText: { color: palette.ink, fontSize: 12, fontWeight: "900" },
  flex: { flex: 1 },
  muted: { color: palette.muted, fontSize: 13, lineHeight: 18 },
  screen: { gap: 12 },
  hero: {
    gap: 8,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 8,
    padding: 16,
    backgroundColor: palette.panel2
  },
  eyebrow: { color: palette.facebook, fontSize: 11, fontWeight: "900", textTransform: "uppercase" },
  heroTitle: { color: palette.text, fontSize: 26, fontWeight: "900", lineHeight: 31 },
  heroBody: { color: palette.muted, fontSize: 14, lineHeight: 20 },
  panel: {
    gap: 9,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 8,
    padding: 14,
    backgroundColor: palette.panel
  },
  panelTitle: { color: palette.text, fontSize: 17, fontWeight: "900" },
  textInput: {
    minHeight: 48,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#334155",
    color: palette.text,
    backgroundColor: palette.bg,
    paddingHorizontal: 12,
    fontSize: 14
  },
  rowCard: {
    minHeight: 74,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 8,
    padding: 13,
    backgroundColor: palette.panel
  },
  rowTitle: { color: palette.text, fontSize: 14, fontWeight: "900" },
  pageCard: {
    overflow: "hidden",
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 8,
    backgroundColor: palette.panel
  },
  pageCardSelected: { borderColor: palette.facebook, backgroundColor: "#1f2329" },
  pageCoverFrame: { position: "relative" },
  pageCover: {
    width: "100%",
    aspectRatio: 2.65,
    backgroundColor: "#2a2622"
  },
  pageCoverPlaceholder: { backgroundColor: "#2a2622" },
  selectedBadge: {
    position: "absolute",
    top: 10,
    right: 10,
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 8,
    paddingHorizontal: 9,
    backgroundColor: "rgba(17,16,15,0.86)"
  },
  selectedBadgeText: { color: palette.good, fontSize: 11, fontWeight: "900" },
  pageCardBody: {
    minHeight: 86,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 13,
    paddingVertical: 11
  },
  pageAvatar: {
    width: 52,
    height: 52,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: palette.panel,
    backgroundColor: "#2a2622"
  },
  pageAvatarPlaceholder: {
    width: 52,
    height: 52,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2a2622"
  },
  pageAvatarText: { color: palette.text, fontSize: 20, fontWeight: "900" },
  pageName: { color: palette.text, fontSize: 18, fontWeight: "900", lineHeight: 22 },
  pageMeta: { color: palette.muted, fontSize: 12, fontWeight: "700", marginTop: 2 },
  pageBadges: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  disabled: { opacity: 0.55 },
  policyRow: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 8,
    padding: 10,
    backgroundColor: "#17241c"
  },
  progressTrack: { height: 8, borderRadius: 4, overflow: "hidden", backgroundColor: "#332f2b" },
  progressFill: { height: 8, borderRadius: 4, backgroundColor: palette.facebook },
  metricGrid: { flexDirection: "row", gap: 8 },
  metricCell: {
    flex: 1,
    minHeight: 76,
    justifyContent: "center",
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 8,
    padding: 12,
    backgroundColor: palette.panel
  },
  metricValue: { color: palette.text, fontSize: 24, fontWeight: "900" },
  metricLabel: { color: palette.muted, fontSize: 12, fontWeight: "700" },
  button: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 8,
    paddingHorizontal: 14,
    backgroundColor: palette.facebook
  },
  buttonText: { color: palette.ink, fontSize: 14, fontWeight: "900", textAlign: "center" },
  secondaryButton: { backgroundColor: palette.white },
  secondaryButtonText: { color: palette.bg },
  dangerButton: { borderWidth: 1, borderColor: "#7f1d1d", backgroundColor: "#2a1215" },
  dangerButtonText: { color: palette.danger },
  actionPair: { flexDirection: "row", gap: 10 },
  empty: { gap: 4, paddingVertical: 4 },
  mediaRow: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 10 },
  thumbnail: { width: 50, height: 50, borderRadius: 8, borderWidth: 1, borderColor: "#334155", backgroundColor: "#233044" },
  variantImage: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#334155",
    backgroundColor: "#0f172a"
  },
  captionInput: {
    minHeight: 104,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#334155",
    color: palette.text,
    backgroundColor: palette.bg,
    padding: 12,
    textAlignVertical: "top"
  },
  calendarCard: {
    flexDirection: "row",
    gap: 10,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 8,
    padding: 12,
    backgroundColor: palette.panel
  },
  timelineDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: palette.cyan, marginTop: 5 },
  captionPreview: { color: palette.muted, fontSize: 13, lineHeight: 18 },
  compactActions: { width: 82, gap: 8 },
  miniButton: { minHeight: 34, alignItems: "center", justifyContent: "center", borderRadius: 8, backgroundColor: palette.facebook },
  miniText: { color: palette.ink, fontSize: 11, fontWeight: "900" },
  miniDanger: { borderWidth: 1, borderColor: "#7f1d1d", backgroundColor: "#2a1215" },
  miniDangerText: { color: palette.danger },
  pill: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5, backgroundColor: "#293241" },
  pillGood: { backgroundColor: "#123526" },
  pillWarn: { backgroundColor: "#3a2b12" },
  pillText: { color: palette.muted, fontSize: 11, fontWeight: "900" },
  pillGoodText: { color: "#86efac" },
  pillWarnText: { color: palette.warning },
  alert: { borderRadius: 8, borderWidth: 1, padding: 12 },
  alertCritical: { borderColor: "#7f1d1d", backgroundColor: "#2a1215" },
  alertWarning: { borderColor: "#854d0e", backgroundColor: "#2b2112" },
  alertText: { fontSize: 13, fontWeight: "800", lineHeight: 18 },
  alertCriticalText: { color: palette.danger },
  alertWarningText: { color: palette.warning },
  tabs: {
    position: "absolute",
    left: 14,
    right: 14,
    bottom: Platform.OS === "android" ? 18 : 12,
    flexDirection: "row",
    gap: 4,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 8,
    padding: 6,
    backgroundColor: "rgba(24,23,22,0.98)"
  },
  tab: { flex: 1, minHeight: 52, alignItems: "center", justifyContent: "center", gap: 3, borderRadius: 8 },
  activeTab: { backgroundColor: palette.white },
  tabText: { color: palette.muted, fontSize: 12, fontWeight: "900" },
  activeTabText: { color: palette.ink },
  badge: { position: "absolute", top: 8, right: 16, width: 7, height: 7, borderRadius: 4, backgroundColor: "#f87171" }
});
