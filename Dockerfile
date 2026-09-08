FROM alpine:3.22

RUN apk add --no-cache ca-certificates curl openssh-client \
    && addgroup -S -g 10001 ncx \
    && adduser -S -D -u 10001 -h /home/ncx -G ncx ncx \
    && install -d -o 10001 -g 10001 -m 0700 /home/ncx/.ssh \
    && install -d -o 10001 -g 10001 -m 0755 /opt/ncx \
    && ln -s /opt/ncx/ncx /usr/local/bin/ncx
COPY --chmod=0755 deploy/update.sh /usr/local/bin/update.sh

ENV HOME=/home/ncx
USER 10001:10001
WORKDIR /home/ncx
RUN update.sh
VOLUME ["/opt/ncx"]
ENTRYPOINT ["/usr/local/bin/ncx"]
CMD ["--help"]
