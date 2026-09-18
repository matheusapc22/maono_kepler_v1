export class PreparedNavigationIntentController {
  private currentIntent = 0;

  begin() {
    this.currentIntent += 1;
    return this.currentIntent;
  }

  isCurrent(intent: number) {
    return intent === this.currentIntent;
  }

  cancel() {
    this.currentIntent += 1;
  }
}
