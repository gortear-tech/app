import { QueryClient, QueryClientProvider, useMutation, useQuery } from "@tanstack/react-query";
import { StatusBar } from "expo-status-bar";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  Pressable,
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
  createMockPhotoUpload,
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
  storeDevelopmentSession,
  updateBusinessAutonomy,
  updateVariantCaption
} from "./src/api/client";
import { getMobileConfig } from "./src/config";

const queryClient = new QueryClient();
type TabKey = "today" | "create" | "calendar" | "business";

function BootScreen() {
  const config = getMobileConfig();
  const [tab, setTab] = useState<TabKey>("today");
  const [captionDrafts, setCaptionDrafts] = useState<Record<string, string>>({});

  const tokenQuery = useQuery({ queryKey: ["session-token"], queryFn: getStoredSessionToken });
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
    mutationFn: async () => connectMeta(token),
    onSuccess: async (result) => {
      if (result.authorizationUrl) await Linking.openURL(result.authorizationUrl);
      await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
      await queryClient.invalidateQueries({ queryKey: ["pages"] });
    }
  });
  const startFacebook = useMutation({
    mutationFn: async () => {
      const sessionToken = "dev:mobile-user:mobile@example.com";
      await storeDevelopmentSession(sessionToken);
      const result = await connectMeta(sessionToken);
      if (result.authorizationUrl) await Linking.openURL(result.authorizationUrl);
      return result;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["session-token"] });
      await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
      await queryClient.invalidateQueries({ queryKey: ["pages"] });
    }
  });
  const selectPage = useMutation({
    mutationFn: async (pageId: string) => selectMetaPage(token, pageId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
      await queryClient.invalidateQueries({ queryKey: ["pages"] });
    }
  });
  const startBatch = useMutation({ mutationFn: async () => createBatch(token, selectedBusinessId ?? ""), onSuccess: invalidateWork });
  const uploadMock = useMutation({
    mutationFn: async () => createMockPhotoUpload(token, selectedBusinessId ?? "", activeBatch.data?.id ?? ""),
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

  const stateText = useMemo(() => {
    if (bootstrap.isLoading) return "Revisando conexion inicial...";
    if (bootstrap.isError) return "No pudimos conectar con FBmaniaco.";
    if (!bootstrap.data?.authenticated) return "Sesion no iniciada.";
    return `Sesion activa: ${bootstrap.data.user?.email ?? "usuario"}`;
  }, [bootstrap.data, bootstrap.isError, bootstrap.isLoading]);

  const visibleError =
    bootstrap.error ??
    startFacebook.error ??
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
    uploadMock.error ??
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
    if (config.appEnv === "development" && !bootstrap.data?.authenticated) {
      return (
        <Screen>
          <Hero
            title="Conecta Facebook"
            eyebrow="Inicio"
            body="Abriremos Facebook para elegir tu pagina. Si el servidor esta en modo demo, continuaremos con una pagina de prueba."
          />
          <Button
            label={startFacebook.isPending ? "Abriendo Facebook..." : "Conectar con Facebook"}
            disabled={startFacebook.isPending}
            onPress={() => startFacebook.mutate()}
          />
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
          <Button label={connect.isPending ? "Conectando..." : "Conectar con Facebook"} disabled={connect.isPending} onPress={() => connect.mutate()} />
        </Screen>
      );
    }

    if (bootstrap.data?.nextStep === "select_page") {
      return (
        <Screen>
          <Hero title="Elige tu pagina" eyebrow="Negocio" body="Selecciona la pagina donde vas a preparar publicaciones." />
          {(pages.data ?? []).map((page) => (
            <Pressable
              key={page.id}
              style={[styles.rowCard, !page.canPublish ? styles.disabled : null]}
              disabled={!page.canPublish || selectPage.isPending}
              onPress={() => selectPage.mutate(page.id)}
            >
              <View style={styles.flex}>
                <Text style={styles.rowTitle}>{page.pageName}</Text>
                <Text style={styles.muted}>{page.canPublish ? "Lista para publicar" : "Necesita permisos o reconexion"}</Text>
              </View>
              <Pill label={page.pageAccessTokenStatus} tone={page.canPublish ? "good" : "warn"} />
            </Pressable>
          ))}
          {pages.isLoading ? <ActivityIndicator color={palette.cyan} /> : null}
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
      <ActionPair
        primaryLabel={startBatch.isPending ? "Creando..." : "Crear lote"}
        primaryDisabled={startBatch.isPending || !selectedBusinessId}
        onPrimary={() => startBatch.mutate()}
        secondaryLabel={uploadMock.isPending ? "Subiendo..." : "Foto demo"}
        secondaryDisabled={!activeBatch.data || uploadMock.isPending}
        onSecondary={() => uploadMock.mutate()}
      />
      <Panel title="Fotos">
        {photos.length === 0 ? <EmptyState title="Aun no hay fotos" body="Agrega una foto demo para validar el flujo de aprobacion." /> : null}
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
        <Button label={generateVariants.isPending ? "Preparando..." : "Generar variante"} disabled={generateVariants.isPending} onPress={() => generateVariants.mutate()} />
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
            secondaryLabel="Guardar caption"
            secondaryDisabled={saveCaption.isPending}
            onSecondary={() => saveCaption.mutate(variant.id)}
          />
          <Button label="Rechazar variante" variant="danger" disabled={reject.isPending} onPress={() => reject.mutate(variant.id)} />
        </Panel>
      ))}
      {approvedCount > 0 ? (
        <Button label={schedule.isPending ? "Programando..." : "Confirmar calendario de 7 dias"} disabled={schedule.isPending} onPress={() => schedule.mutate()} />
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
          <Text style={styles.muted}>Autopublicacion: {businessDetail.data?.autonomy.canAutopublish ? "lista" : "requiere confirmacion"}</Text>
          {(businessDetail.data?.autonomy.blockingReasons ?? ["explicit_opt_in_required"]).slice(0, 3).map((reason: string) => (
            <Text key={reason} style={styles.muted}>{reason}</Text>
          ))}
        </Panel>
        <Panel title="Paginas de Facebook">
          {(pages.data ?? []).length === 0 ? (
            <Text style={styles.muted}>Conecta Facebook para ver tus paginas.</Text>
          ) : null}
          {(pages.data ?? []).map((page) => (
            <Pressable
              key={page.id}
              style={[styles.rowCard, !page.canPublish || selectPage.isPending ? styles.disabled : null]}
              disabled={!page.canPublish || selectPage.isPending}
              onPress={() => selectPage.mutate(page.id)}
            >
              <View style={styles.flex}>
                <Text style={styles.rowTitle}>{page.pageName}</Text>
                <Text style={styles.muted}>
                  {page.isSelected ? "Pagina activa" : page.canPublish ? "Tocar para usar esta pagina" : "Faltan permisos de publicacion"}
                </Text>
              </View>
              <Pill label={page.isSelected ? "activa" : page.pageAccessTokenStatus} tone={page.canPublish ? "good" : "warn"} />
            </Pressable>
          ))}
          <Button label={connect.isPending ? "Conectando..." : "Reconectar Facebook"} variant="secondary" disabled={connect.isPending} onPress={() => connect.mutate()} />
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
            secondaryLabel={collect.isPending ? "Recolectando..." : "Metricas"}
            secondaryDisabled={collect.isPending || !selectedBusinessId}
            onSecondary={() => collect.mutate()}
          />
        </Panel>
        <Panel title="Autonomia">
          <Text style={styles.muted}>FACEBOOK_PUBLISH requiere opt-in explicito, token sano y presupuesto disponible.</Text>
          <Button label={resetAutonomy.isPending ? "Reseteando..." : "Resetear autonomia"} variant="secondary" disabled={resetAutonomy.isPending} onPress={() => resetAutonomy.mutate()} />
        </Panel>
        <Panel title="Evaluaciones IA">
          <Text style={styles.muted}>Las pruebas de captions corren como job y no bloquean aprobaciones en vivo.</Text>
          <Button label={captionEval.isPending ? "Encolando..." : "Ejecutar eval de captions"} disabled={captionEval.isPending} onPress={() => captionEval.mutate()} />
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
        <ScrollView contentContainerStyle={styles.container}>
          <View style={styles.header}>
            <Text style={styles.brand}>FBmaniaco</Text>
            <Text style={styles.subtitle}>Publicaciones para tu pagina, con control desde el celular.</Text>
          </View>
          <View style={styles.statusBar}>
            {bootstrap.isLoading ? <ActivityIndicator color={palette.cyan} /> : null}
            <View style={styles.flex}>
              <Text style={styles.statusText}>{stateText}</Text>
              <Text style={styles.muted} numberOfLines={1}>API: {config.apiUrl}</Text>
            </View>
          </View>
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

function Hero({ title, eyebrow, body }: { title: string; eyebrow: string; body: string }) {
  return (
    <View style={styles.hero}>
      <Text style={styles.eyebrow}>{eyebrow}</Text>
      <Text style={styles.heroTitle}>{title}</Text>
      <Text style={styles.heroBody}>{body}</Text>
    </View>
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
  variant = "primary"
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean | undefined;
  variant?: "primary" | "secondary" | "danger";
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
    >
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
  secondaryDisabled
}: {
  primaryLabel: string;
  secondaryLabel: string;
  onPrimary: () => void;
  onSecondary: () => void;
  primaryDisabled?: boolean | undefined;
  secondaryDisabled?: boolean | undefined;
}) {
  return (
    <View style={styles.actionPair}>
      <View style={styles.flex}>
        <Button label={secondaryLabel} variant="secondary" disabled={secondaryDisabled} onPress={onSecondary} />
      </View>
      <View style={styles.flex}>
        <Button label={primaryLabel} disabled={primaryDisabled} onPress={onPrimary} />
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
  const tabs: Array<[TabKey, string]> = [
    ["today", "Hoy"],
    ["create", "Crear"],
    ["calendar", "Calendario"],
    ["business", "Negocio"]
  ];
  return (
    <View style={styles.tabs}>
      {tabs.map(([key, label]) => (
        <Pressable key={key} style={[styles.tab, active === key ? styles.activeTab : null]} onPress={() => onChange(key)}>
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
  bg: "#0f1217",
  panel: "#171c24",
  panel2: "#1c2430",
  border: "#2b3442",
  text: "#f8fafc",
  muted: "#aeb7c2",
  cyan: "#38bdf8",
  white: "#f8fafc",
  danger: "#fecaca",
  warning: "#fde68a"
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  shell: { flex: 1 },
  container: { flexGrow: 1, gap: 16, padding: 18, paddingBottom: 104 },
  header: { gap: 6, paddingTop: 6 },
  brand: { color: palette.text, fontSize: 34, fontWeight: "900" },
  subtitle: { color: palette.muted, fontSize: 15, lineHeight: 21 },
  statusBar: {
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
  eyebrow: { color: palette.cyan, fontSize: 11, fontWeight: "900", textTransform: "uppercase" },
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
  disabled: { opacity: 0.55 },
  progressTrack: { height: 8, borderRadius: 4, overflow: "hidden", backgroundColor: "#2d3745" },
  progressFill: { height: 8, borderRadius: 4, backgroundColor: palette.cyan },
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
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    paddingHorizontal: 14,
    backgroundColor: palette.cyan
  },
  buttonText: { color: "#07111f", fontSize: 14, fontWeight: "900", textAlign: "center" },
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
  miniButton: { minHeight: 34, alignItems: "center", justifyContent: "center", borderRadius: 8, backgroundColor: palette.cyan },
  miniText: { color: "#07111f", fontSize: 11, fontWeight: "900" },
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
    left: 12,
    right: 12,
    bottom: 12,
    flexDirection: "row",
    gap: 6,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 8,
    padding: 6,
    backgroundColor: "#151a22"
  },
  tab: { flex: 1, minHeight: 46, alignItems: "center", justifyContent: "center", borderRadius: 8 },
  activeTab: { backgroundColor: palette.white },
  tabText: { color: palette.muted, fontSize: 12, fontWeight: "900" },
  activeTabText: { color: palette.bg },
  badge: { position: "absolute", top: 8, right: 16, width: 7, height: 7, borderRadius: 4, backgroundColor: "#f87171" }
});
