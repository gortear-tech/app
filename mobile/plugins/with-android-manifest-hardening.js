const { withAndroidManifest } = require('@expo/config-plugins');

const REMOVED_QUERY_ACTIONS = new Set([
  'android.intent.action.OPEN_DOCUMENT_TREE',
  'android.media.action.IMAGE_CAPTURE',
  'android.media.action.ACTION_VIDEO_CAPTURE',
]);

function getActionName(intent) {
  const action = intent?.action?.[0]?.$;
  return action?.['android:name'];
}

function withAndroidManifestHardening(config) {
  return withAndroidManifest(config, (expoConfig) => {
    const manifest = expoConfig.modResults.manifest;
    const queries = manifest.queries?.[0];

    if (queries?.intent) {
      queries.intent = queries.intent.filter((intent) => !REMOVED_QUERY_ACTIONS.has(getActionName(intent)));

      if (queries.intent.length === 0) {
        delete queries.intent;
      }
    }

    return expoConfig;
  });
}

module.exports = withAndroidManifestHardening;
