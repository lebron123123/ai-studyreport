// Check ownership on both sides of every asynchronous initialization stage.
export async function initializeSceneStages(stages, isActive) {
 for (const stage of stages) {
  if (!isActive()) return false;
  await stage();
  if (!isActive()) return false;
 }
 return true;
}
