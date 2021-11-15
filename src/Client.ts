import * as WebSocket from "ws";
import Game from "./Game";
import Player from "./Entity/Player/Player";
import Entity from "./Entity/Entity";
import { Writer, Reader } from "./Coder";
import { PlayerInputs } from "./types";

export default class Client {
  public socket: WebSocket;
  public inputs: PlayerInputs;
  public game: Game;
  public player: Player | null;
  public view: Set<Entity>;

  constructor(game: Game, socket: WebSocket) {
    this.game = game;
    
    this.game.server.clients.add(this);

    this.player = null;

    this.view = new Set();
    this.inputs = { angle: 0, distance: 0, mousePressed: false };
    this.socket = socket;

    this.sendInit();

    this.socket.on("message", data => {
      const reader = new Reader(data as Buffer);

      const packetType = reader.vu();
      if (packetType === 0) {
        this.inputs.mousePressed = !!reader.vu();
        this.inputs.angle = reader.vi() / 64;
        this.inputs.distance = reader.vu();
      } else if (packetType === 1) {
        if (this.player != null) return;
        const name = reader.string();
        this.player = new Player(this.game, name, this);
        this.sendPlayerId();
      }
    });
  }

  sendInit() {
    const writer = new Writer();
    writer.vu(1);

    writer.vu(this.game.size);

    this.socket.send(writer.write());
  }

  sendPlayerId() {
    if (this.player == null) throw new Error("cannot write player id");

    const writer = new Writer();
    writer.vu(2);

    writer.vu(this.player.id);

    this.socket.send(writer.write());
  }

  sendUpdate() {
    if (!this.player) return;

    const writer = new Writer();

    writer.vu(0);

    /** @ts-ignore */
    const entitiesInView = new Set(this.game.spatialHashing.query({
      position: this.player.position,
      size: 700,
    })) as Set<Entity>;

    this.view.forEach((entity: Entity) => {
      if (!entity.sentToClient) return;

      if (!entitiesInView.has(entity)) {
        this.view.delete(entity);
        writer.vu(entity.id);
      }
    });

    writer.vu(0);

    entitiesInView.forEach((entity: Entity) => {
      if (!entity.sentToClient) return;

      const isCreation = !this.view.has(entity);

      if (isCreation) this.view.add(entity);

      writer.vu(entity.id);
      writer.vu(isCreation ? 1 : 0);
      entity.writeBinary(writer, isCreation);
    });

    writer.vu(0);

    console.log(new Uint8Array(writer.write()).length);
    this.socket.send(writer.write());
  }

  killPlayer() {
    if (this.player == null) throw new Error("tried to kill nonexistant player");

    this.player.terminate();
  }

  terminateSocket() {
    if (this.player != null) this.player.terminate();

    this.game.server.clients.delete(this);
  }

  tick(tick: number) {
    this.sendUpdate();
    if (this.player == null) return;

    if (this.inputs.distance > 80) this.player.applyForce(this.inputs.angle, 1);

    this.player.tick(tick);
  }
}
